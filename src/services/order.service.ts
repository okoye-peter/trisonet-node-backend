import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { ORDER_GROUP_STATUSES, WITHDRAWAL_STATUSES, ORDER_RETURN_STATUSES, SHOP_RETURN_WINDOW_DAYS } from "../config/constants";
import { PagaService } from "./paga.service";
import { paginate } from "../utils/pagination";
import { CommissionLogService } from "./commission_log.service";
import { isBuyable } from "./product.service";
import { canUseSellerFeatures } from "../utils/sellerAccess";

const pagaService = new PagaService();

interface CreateOrderItemInput {
    productId: string;
    quantity: number;
}

interface ShippingInput {
    fullName: string;
    phone: string;
    address: string;
    city: string;
    state: string;
}

interface CreateOrderInput {
    items: CreateOrderItemInput[];
    shipping: ShippingInput;
}

interface OrderItemSnapshot {
    productId: string;
    quantity: number;
    price: number;
    name: string;
    image: string;
}

type ShippingStatusLabel = 'cancelled' | 'pending' | 'shipped' | 'delivered';

const { CANCELLED, PENDING, SHIPPED, DELIVERED } = ORDER_GROUP_STATUSES;

/** Matches checkouts whose combined status (see combinedDelivery) is the given one. */
const combinedStatusWhere = (status: ShippingStatusLabel): Prisma.PendingShopOrderWhereInput => {
    switch (status) {
        case 'cancelled':
            return { orderGroups: { some: {}, every: { status: CANCELLED } } };
        case 'delivered':
            return { orderGroups: { some: { status: DELIVERED }, none: { status: { in: [PENDING, SHIPPED] } } } };
        case 'shipped':
            return { AND: [{ orderGroups: { some: { status: { in: [SHIPPED, DELIVERED] } } } }, { orderGroups: { some: { status: { in: [PENDING, SHIPPED] } } } }] };
        case 'pending':
            return { orderGroups: { some: { status: PENDING }, none: { status: { in: [SHIPPED, DELIVERED] } } } };
    }
};

const isWithinReturnWindow = (deliveredAt: Date): boolean => {
    const deadline = deliveredAt.getTime() + SHOP_RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() <= deadline;
};

type ReturnItemStatus = 'requested' | 'returned';

// A checkout only ever produces a PendingShopOrder row — see PaymentService.processShopOrderPayment
// for where the real OrderGroup/OrderItem/OrderTransaction rows get created once payment is
// confirmed. Every order the buyer can see, paid or not, is read back through this row.
//
// A paid checkout has one order group per seller (see processShopOrderPayment) so each seller
// ships and marks delivered their own part, but the buyer only ever sees ONE order: one item
// list, one status and one return window. Nothing here exposes the per-seller refNos or
// seller names. The order is:
//   - delivered once every (non-cancelled) part is delivered - its delivery date is the last part's;
//   - shipped once any part has left a seller;
//   - pending until then.
// The return window opens when the whole order is delivered, for every item at once.
// Callers that need statuses must include `orderGroups` (checkouts from before the split only
// link their single group through `orderGroup`, which is used as a fallback). Callers that also
// need per-item return eligibility must include `orderGroups.orderItems.product` and pass
// `returnItemStatuses` (order_item id -> 'requested' while the PHP admin's return review is
// still pending, 'returned' once they've approved it; a rejected return item is left out).
const checkoutGroups = (pending: any): any[] =>
    pending.orderGroups?.length ? pending.orderGroups : pending.orderGroup ? [pending.orderGroup] : [];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The buyer-facing status and delivery date of a whole checkout, from its parts. */
export const combinedDelivery = (groups: Array<{ status: number; deliveredAt: Date | null }>) => {
    if (groups.length === 0) return { status: null as ShippingStatusLabel | null, deliveredAt: null as Date | null };
    const active = groups.filter((g) => g.status !== ORDER_GROUP_STATUSES.CANCELLED);
    if (active.length === 0) return { status: 'cancelled' as const, deliveredAt: null };

    if (active.every((g) => g.status === ORDER_GROUP_STATUSES.DELIVERED)) {
        // A part the PHP admin marked delivered always gets delivered_at, but fall back to
        // "now" rather than leave a delivered order with no date (and no return window).
        const deliveredAt = new Date(Math.max(...active.map((g) => (g.deliveredAt ?? new Date()).getTime())));
        return { status: 'delivered' as const, deliveredAt };
    }
    const anyMoved = active.some((g) => g.status === ORDER_GROUP_STATUSES.SHIPPED || g.status === ORDER_GROUP_STATUSES.DELIVERED);
    return { status: (anyMoved ? 'shipped' : 'pending') as ShippingStatusLabel, deliveredAt: null };
};

const returnWindowInfo = (deliveredAt: Date | null) => {
    const withinReturnWindow = deliveredAt ? isWithinReturnWindow(deliveredAt) : false;
    // Rounded up so "expires in a few hours" still reads as "1 day left" rather than
    // "0 days left" (which would look like the window already closed).
    const daysLeftToReturn = withinReturnWindow && deliveredAt
        ? Math.max(1, Math.ceil((deliveredAt.getTime() + SHOP_RETURN_WINDOW_DAYS * DAY_MS - Date.now()) / DAY_MS))
        : null;
    // True once the window has definitively closed (as opposed to never having
    // opened, e.g. not delivered yet) - lets the buyer see why "Request Return" is gone.
    const returnWindowExpired = !!deliveredAt && !withinReturnWindow;
    return { withinReturnWindow, daysLeftToReturn, returnWindowExpired };
};

const serializePendingOrder = (pending: any, options: { returnItemStatuses?: Map<string, ReturnItemStatus> | undefined } = {}) => {
    const shipping = (pending.shipping ?? null) as (ShippingInput & { paymentMethod?: string }) | null;
    const groups = checkoutGroups(pending);
    const { status: shippingStatus, deliveredAt } = combinedDelivery(groups);
    const { withinReturnWindow, daysLeftToReturn, returnWindowExpired } = returnWindowInfo(deliveredAt);

    const realItems = groups.flatMap((g) =>
        ((g.orderItems ?? []) as Array<{ id: bigint; productId: bigint; quantity: number; price: unknown; product: { name: string; image: string; isReturnable: boolean } }>)
            .map((item) => ({ group: g, item })));

    const items = realItems.length > 0
        ? realItems.map(({ group, item }) => {
            const returnStatus = options.returnItemStatuses?.get(item.id.toString());
            const hasActiveReturn = returnStatus !== undefined;
            // Only when an admin cancels one part of an order (e.g. a seller never delivered):
            // those items were refunded and won't arrive.
            const isCancelled = group.status === ORDER_GROUP_STATUSES.CANCELLED && shippingStatus !== 'cancelled';
            return {
                id: item.id.toString(),
                productId: item.productId.toString(),
                quantity: item.quantity,
                price: Number(item.price),
                product: { id: item.productId.toString(), name: item.product.name, image: item.product.image },
                isReturnable: item.product.isReturnable,
                isCancelled,
                hasActiveReturn,
                returnStatus: returnStatus ?? null,
                canReturn: withinReturnWindow && !isCancelled && item.product.isReturnable && !hasActiveReturn,
            };
        })
        : ((pending.items ?? []) as OrderItemSnapshot[]).map((item, index) => ({
            id: `${pending.id}-${index}`,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            product: { id: item.productId, name: item.name, image: item.image },
            isReturnable: false,
            isCancelled: false,
            hasActiveReturn: false,
            returnStatus: null,
            canReturn: false,
        }));

    return {
        id: pending.id.toString(),
        refNo: pending.refNo,
        status: true,
        shipping,
        total: Number(pending.amount),
        createdAt: pending.createdAt,
        paymentStatus: pending.status,
        paymentReference: pending.paymentReference,
        virtualAccount: pending.paymentDetails ?? undefined,
        shippingStatus,
        deliveredAt,
        // Cancelling refunds the whole checkout, so only while no seller has shipped yet.
        canCancel: groups.length > 0 && groups.every((g) => g.status === ORDER_GROUP_STATUSES.PENDING),
        canReturn: items.some((item) => item.canReturn),
        daysLeftToReturn,
        returnWindowExpired,
        items,
    };
};

// The per-seller parts of a checkout. Seller details are deliberately not loaded - the buyer
// sees one combined order (see serializePendingOrder).
const partsInclude = {
    orderBy: { id: 'asc' as const },
};

const partsWithItemsInclude = {
    orderBy: { id: 'asc' as const },
    include: { orderItems: { include: { product: true } } },
};

interface GuestContact {
    name: string;
    email: string;
    phone: string;
}

const buildPendingOrder = async (
    payload: CreateOrderInput,
    contact: { name?: string | null; email?: string | null; username?: string | null },
    identity: { userId: bigint; guest?: undefined } | { userId?: undefined; guest: GuestContact }
) => {
    const productIds = payload.items.map((i) => BigInt(i.productId));

    const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { sellerStore: { select: { status: true } } },
    });

    const productMap = new Map(products.map((p) => [p.id.toString(), p]));

    let subtotal = 0;
    const items: OrderItemSnapshot[] = [];
    for (const item of payload.items) {
        const product = productMap.get(item.productId);
        // Guests and anyone outside the seller beta can't buy partner products (utils/sellerAccess.ts).
        if (!product || !isBuyable(product) || (product.sellerStoreId !== null && !canUseSellerFeatures(contact))) {
            throw new AppError(`Product ${item.productId} not found`, 404);
        }
        if (item.quantity > product.quantity) {
            throw new AppError(`Insufficient stock for ${product.name}`, 400);
        }

        const price = parseFloat(product.price);
        subtotal += price * item.quantity;
        items.push({
            productId: product.id.toString(),
            quantity: item.quantity,
            price,
            name: product.name,
            image: product.image,
        });
    }

    const total = subtotal;
    const refNo = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const paymentReference = pagaService.generateReference('ORDER');

    const virtualAccountResult = await pagaService.generateVirtualAccount(
        total,
        payload.shipping.fullName || contact.name || 'Customer',
        payload.shipping.phone,
        paymentReference,
        contact.email || undefined
    );

    if (!virtualAccountResult.success) {
        throw new AppError(virtualAccountResult.error || 'Failed to generate payment details. Please try again.', 502);
    }

    const virtualAccount = {
        bank_name: virtualAccountResult.data.bank_name,
        account_name: virtualAccountResult.data.account_name,
        account_number: virtualAccountResult.data.virtual_account,
        amount: virtualAccountResult.data.amount,
        expires_at: virtualAccountResult.data.expiry_date_full,
    };

    // Nothing is written to order_groups/order_items/order_transactions here, and no
    // stock is touched — this just reserves a refNo + virtual account for the buyer to
    // pay against. Stock is validated again, and the real order is created, at confirmation.
    const pending = await prisma.pendingShopOrder.create({
        data: {
            userId: identity.userId ?? null,
            guestName: identity.guest?.name ?? null,
            guestEmail: identity.guest?.email ?? null,
            guestPhone: identity.guest?.phone ?? null,
            refNo,
            paymentReference,
            amount: total,
            items: items as unknown as Prisma.InputJsonValue,
            shipping: { ...payload.shipping, paymentMethod: 'paga' } as unknown as Prisma.InputJsonValue,
            paymentDetails: virtualAccount as unknown as Prisma.InputJsonValue,
        },
    });

    return serializePendingOrder(pending);
};

export const createOrder = (userId: bigint, payload: CreateOrderInput, user: { name?: string | null; email?: string | null; username?: string | null }) =>
    buildPendingOrder(payload, user, { userId });

export const createGuestOrder = (payload: CreateOrderInput, guest: GuestContact) =>
    buildPendingOrder(payload, { name: guest.name, email: guest.email }, { guest });

const findPendingOrder = async (where: Prisma.PendingShopOrderWhereInput) => {
    const pending = await prisma.pendingShopOrder.findFirst({
        where,
        include: {
            orderGroup: { include: { orderItems: { include: { product: true } } } },
            orderGroups: partsWithItemsInclude,
        },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    const orderItemIds = checkoutGroups(pending).flatMap((g: any) => g.orderItems.map((item: any) => item.id as bigint));
    let returnItemStatuses: Map<string, ReturnItemStatus> | undefined;
    if (orderItemIds.length) {
        const activeReturnItems = await prisma.orderReturnItem.findMany({
            where: {
                orderItemId: { in: orderItemIds },
                orderReturn: { status: { not: ORDER_RETURN_STATUSES.REJECTED } },
            },
            select: { orderItemId: true, orderReturn: { select: { status: true } } },
        });
        returnItemStatuses = new Map(
            activeReturnItems.map((r) => [
                r.orderItemId.toString(),
                r.orderReturn.status === ORDER_RETURN_STATUSES.APPROVED ? 'returned' : 'requested',
            ])
        );
    }

    return serializePendingOrder(pending, { returnItemStatuses });
};

export const getOrderByRefNo = (refNo: string, userId: bigint) =>
    findPendingOrder({ refNo, userId });

// Guests have no account to scope by, so the email supplied at checkout doubles as
// the lookup credential — a stranger who only knows the refNo can't view the order.
export const getGuestOrderByRefNo = (refNo: string, guestEmail: string) =>
    findPendingOrder({ refNo, guestEmail, userId: null });

interface CreateReturnInput {
    reason: string;
    orderItemIds: string[];
    bankName: string;
    bankUUID: string;
    accountNumber: string;
}

export const createReturn = async (refNo: string, userId: bigint, payload: CreateReturnInput) => {
    const pending = await prisma.pendingShopOrder.findFirst({
        where: { refNo, userId },
        include: { orderGroups: { include: { orderItems: { include: { product: true } } } } },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    // The buyer returns items from one combined order, and only once all of it has been
    // delivered (the return window is the whole order's). Behind the scenes each seller's
    // items are a separate order group, so a request that spans sellers becomes one
    // OrderReturn per group - each seller's part is reviewed and refunded on its own in PHP.
    const { status, deliveredAt } = combinedDelivery(pending.orderGroups);
    if (status !== 'delivered' || !deliveredAt) {
        throw new AppError('Only delivered orders can be returned', 400);
    }
    if (!isWithinReturnWindow(deliveredAt)) {
        throw new AppError(`The return window (${SHOP_RETURN_WINDOW_DAYS} days after delivery) for this order has passed`, 400);
    }

    const requestedItemIds = payload.orderItemIds.map((id) => BigInt(id));
    const deliveredGroups = pending.orderGroups.filter((g) => g.status === ORDER_GROUP_STATUSES.DELIVERED);
    const selected = deliveredGroups.flatMap((g) =>
        g.orderItems.filter((item) => requestedItemIds.includes(item.id)).map((item) => ({ group: g, item })));

    if (selected.length !== requestedItemIds.length) {
        throw new AppError('One or more selected items do not belong to this order', 400);
    }

    for (const { item } of selected) {
        if (!item.product.isReturnable) {
            throw new AppError(`"${item.product.name}" is not returnable`, 400);
        }
    }

    const existingActive = await prisma.orderReturnItem.findFirst({
        where: {
            orderItemId: { in: requestedItemIds },
            orderReturn: { status: { not: ORDER_RETURN_STATUSES.REJECTED } },
        },
    });
    if (existingActive) {
        throw new AppError('One or more selected items already have a return request', 400);
    }

    const resolved = await pagaService.resolveBankDetails(payload.bankUUID, payload.accountNumber);
    if (!resolved.success) {
        throw new AppError(resolved.error || 'Could not verify the provided bank account. Please check the details and try again.', 400);
    }

    const byGroup = new Map<string, { groupId: bigint; items: typeof selected }>();
    for (const entry of selected) {
        const key = entry.group.id.toString();
        if (!byGroup.has(key)) byGroup.set(key, { groupId: entry.group.id, items: [] });
        byGroup.get(key)!.items.push(entry);
    }

    const returns = await prisma.$transaction(async (tx) => {
        const created = [];
        for (const { groupId, items } of byGroup.values()) {
            const refundedAmount = items.reduce((sum, { item }) => sum + item.quantity * Number(item.price), 0);
            const orderReturn = await tx.orderReturn.create({
                data: {
                    orderGroupId: groupId,
                    userId,
                    reason: payload.reason,
                    bankName: payload.bankName,
                    accountNumber: payload.accountNumber,
                    status: ORDER_RETURN_STATUSES.PENDING,
                    refundedAmount,
                },
            });

            await tx.orderReturnItem.createMany({
                data: items.map(({ item }) => ({
                    orderReturnId: orderReturn.id,
                    orderItemId: item.id,
                    quantity: item.quantity,
                    price: item.price,
                })),
            });
            created.push(orderReturn);
        }
        return created;
    });

    // One request as far as the buyer is concerned.
    const [first] = returns;
    return {
        id: first!.id.toString(),
        status: 'pending',
        refundedAmount: returns.reduce((sum, r) => sum + Number(r.refundedAmount), 0),
        reason: first!.reason,
        createdAt: first!.createdAt,
    };
};

interface CancelOrderBankDetails {
    bankName: string;
    bankUUID: string;
    accountNumber: string;
}

export const cancelOrder = async (refNo: string, userId: bigint, bankDetails: CancelOrderBankDetails) => {
    const pending = await prisma.pendingShopOrder.findFirst({
        where: { refNo, userId },
        include: { orderGroups: true },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    if (pending.orderGroups.length === 0) {
        throw new AppError('This order has not been confirmed yet and cannot be cancelled', 400);
    }

    // The refund covers the whole checkout, so every seller's part must still be unshipped.
    if (pending.orderGroups.some((g) => g.status !== ORDER_GROUP_STATUSES.PENDING)) {
        throw new AppError('This order can no longer be cancelled', 400);
    }

    // The refund is a real bank transfer, so it must succeed (and be verified) before we touch
    // order/stock state — never tie an external payout to a DB transaction that could roll back.
    const resolved = await pagaService.resolveBankDetails(bankDetails.bankUUID, bankDetails.accountNumber);
    if (!resolved.success) {
        throw new AppError(resolved.error || 'Could not verify the provided bank account. Please check the details and try again.', 400);
    }

    const refundReference = pagaService.generateReference('ORDER_REFUND');
    const payout = await pagaService.withdrawToBank(
        Number(pending.amount),
        bankDetails.bankUUID,
        bankDetails.accountNumber,
        refundReference,
        { remarks: `Refund for cancelled order ${pending.refNo}` }
    );

    if (!payout.success) {
        throw new AppError(payout.message || 'Refund transfer failed. Please check your bank details and try again.', 502);
    }

    const items = (pending.items ?? []) as unknown as OrderItemSnapshot[];

    await prisma.$transaction(async (tx) => {
        const orderGroupIds = pending.orderGroups.map((g) => g.id);

        await tx.orderGroup.updateMany({
            where: { id: { in: orderGroupIds } },
            data: { status: ORDER_GROUP_STATUSES.CANCELLED },
        });

        // Nothing was sold, so no seller is owed anything for these orders.
        await tx.sellerPayout.updateMany({
            where: { orderGroupId: { in: orderGroupIds }, status: { in: ['pending', 'held'] } },
            data: { status: 'cancelled', note: 'Order cancelled by the buyer before shipping' },
        });

        for (const item of items) {
            await tx.product.update({
                where: { id: BigInt(item.productId) },
                data: { quantity: { increment: item.quantity } },
            });
        }

        await tx.withDrawal.create({
            data: {
                userId,
                amount: pending.amount.toString(),
                bankName: bankDetails.bankName,
                accountNumber: bankDetails.accountNumber,
                accountName: resolved.data.account_name,
                isPaid: WITHDRAWAL_STATUSES.SUCCESS,
                userType: 'customer',
                reference: `ORDER_REFUND-${pending.refNo}`,
                pagaRef: payout.reference,
                pagaTransactionId: payout.transaction_id,
            },
        });

        // Matches what the PHP admin's order detail page already reads as this order's
        // "money flow" (CommissionLog rows with reference = order refNo, type order_refund).
        await CommissionLogService.success({
            recipientId: userId,
            type: 'order_refund',
            amount: Number(pending.amount),
            reason: `Refund for cancelled order ${pending.refNo}`,
            reference: pending.refNo,
            processedVia: 'paga_bank_transfer',
            metadata: {
                bankName: bankDetails.bankName,
                accountNumber: bankDetails.accountNumber,
                accountName: resolved.data.account_name,
                // Snake-cased to match the key PHP's OrderGroupController@cancel / OrderReturnController@approve
                // already write here, since the admin "Order Transactions" view reads this JSON key.
                paga_reference: payout.reference,
                pagaTransactionId: payout.transaction_id,
            },
            tx,
        });
    });

    const updated = await prisma.pendingShopOrder.findUniqueOrThrow({
        where: { id: pending.id },
        include: { orderGroups: partsInclude },
    });

    return serializePendingOrder(updated);
};

const findPendingOrderStatus = async (where: Prisma.PendingShopOrderWhereInput) => {
    const pending = await prisma.pendingShopOrder.findFirst({
        where,
        select: { status: true },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    return { status: pending.status };
};

export const getOrderStatus = (refNo: string, userId: bigint) =>
    findPendingOrderStatus({ refNo, userId });

export const getGuestOrderStatus = (refNo: string, guestEmail: string) =>
    findPendingOrderStatus({ refNo, guestEmail, userId: null });

interface GetOrdersFilters {
    search?: string | undefined;
    shippingStatus?: ShippingStatusLabel | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
}

export const getOrdersForUser = async (userId: bigint, page?: number, limit?: number, filters: GetOrdersFilters = {}) => {
    const { search, shippingStatus, dateFrom, dateTo } = filters;

    const createdAt: Prisma.DateTimeFilter = {};
    if (dateFrom) {
        const from = new Date(dateFrom);
        if (!Number.isNaN(from.getTime())) createdAt.gte = from;
    }
    if (dateTo) {
        const to = new Date(dateTo);
        if (!Number.isNaN(to.getTime())) {
            to.setHours(23, 59, 59, 999);
            createdAt.lte = to;
        }
    }

    const result = await paginate(
        prisma.pendingShopOrder,
        {
            where: {
                userId,
                ...(search ? { refNo: { contains: search } } : {}),
                ...(Object.keys(createdAt).length ? { createdAt } : {}),
                ...(shippingStatus ? combinedStatusWhere(shippingStatus) : {}),
            },
            include: { orderGroups: partsInclude },
            orderBy: { createdAt: 'desc' },
        },
        { page, limit }
    );

    return {
        ...result,
        data: result.data.map((p) => serializePendingOrder(p)),
    };
};
