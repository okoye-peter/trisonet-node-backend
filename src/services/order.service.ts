import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { PRODUCT_STATUS, ORDER_GROUP_STATUSES, WITHDRAWAL_STATUSES, ORDER_RETURN_STATUSES, SHOP_RETURN_WINDOW_DAYS } from "../config/constants";
import { PagaService } from "./paga.service";
import { paginate } from "../utils/pagination";
import { CommissionLogService } from "./commission_log.service";

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

const ORDER_GROUP_STATUS_LABEL: Record<number, ShippingStatusLabel> = {
    [ORDER_GROUP_STATUSES.CANCELLED]: 'cancelled',
    [ORDER_GROUP_STATUSES.PENDING]: 'pending',
    [ORDER_GROUP_STATUSES.SHIPPED]: 'shipped',
    [ORDER_GROUP_STATUSES.DELIVERED]: 'delivered',
};

const SHIPPING_STATUS_TO_ORDER_GROUP_STATUS: Record<ShippingStatusLabel, number> = {
    cancelled: ORDER_GROUP_STATUSES.CANCELLED,
    pending: ORDER_GROUP_STATUSES.PENDING,
    shipped: ORDER_GROUP_STATUSES.SHIPPED,
    delivered: ORDER_GROUP_STATUSES.DELIVERED,
};

const isWithinReturnWindow = (deliveredAt: Date): boolean => {
    const deadline = deliveredAt.getTime() + SHOP_RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() <= deadline;
};

type ReturnItemStatus = 'requested' | 'returned';

// A checkout only ever produces a PendingShopOrder row — see PaymentService.processShopOrderPayment
// for where the real OrderGroup/OrderItem/OrderTransaction rows get created once payment is
// confirmed. Every order the buyer can see, paid or not, is read back through this row.
// Callers that need shippingStatus/canCancel to be accurate must include the `orderGroup` relation.
// Callers that also need per-item return eligibility must include `orderGroup.orderItems.product`
// and pass `returnItemStatuses` (order_item id -> 'requested' while the PHP admin's return review
// is still pending, 'returned' once they've approved it — a rejected return item is left out
// entirely, same as before).
const serializePendingOrder = (pending: any, options: { returnItemStatuses?: Map<string, ReturnItemStatus> | undefined } = {}) => {
    const shipping = (pending.shipping ?? null) as (ShippingInput & { paymentMethod?: string }) | null;
    const orderGroupStatus: number | undefined = pending.orderGroup?.status;
    const shippingStatus = orderGroupStatus !== undefined ? ORDER_GROUP_STATUS_LABEL[orderGroupStatus] ?? null : null;
    const deliveredAt: Date | null = pending.orderGroup?.deliveredAt ?? null;
    const withinReturnWindow = shippingStatus === 'delivered' && deliveredAt ? isWithinReturnWindow(deliveredAt) : false;
    // Rounded up so "expires in a few hours" still reads as "1 day left" rather than
    // "0 days left" (which would look like the window already closed).
    const daysLeftToReturn = withinReturnWindow && deliveredAt
        ? Math.max(1, Math.ceil((deliveredAt.getTime() + SHOP_RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000 - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;
    // True once the window has definitively closed (as opposed to never having
    // opened, e.g. not delivered yet) - lets the buyer see why "Request Return" is gone.
    const returnWindowExpired = shippingStatus === 'delivered' && !!deliveredAt && !withinReturnWindow;

    const realOrderItems = pending.orderGroup?.orderItems as
        | Array<{ id: bigint; productId: bigint; quantity: number; price: unknown; product: { name: string; image: string; isReturnable: boolean } }>
        | undefined;

    const items = realOrderItems && realOrderItems.length > 0
        ? realOrderItems.map((item) => {
            const returnStatus = options.returnItemStatuses?.get(item.id.toString());
            const hasActiveReturn = returnStatus !== undefined;
            return {
                id: item.id.toString(),
                productId: item.productId.toString(),
                quantity: item.quantity,
                price: Number(item.price),
                product: { id: item.productId.toString(), name: item.product.name, image: item.product.image },
                isReturnable: item.product.isReturnable,
                hasActiveReturn,
                returnStatus: returnStatus ?? null,
                canReturn: withinReturnWindow && item.product.isReturnable && !hasActiveReturn,
            };
        })
        : ((pending.items ?? []) as OrderItemSnapshot[]).map((item, index) => ({
            id: `${pending.id}-${index}`,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            product: { id: item.productId, name: item.name, image: item.image },
            isReturnable: false,
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
        canCancel: orderGroupStatus === ORDER_GROUP_STATUSES.PENDING,
        canReturn: items.some((item) => item.canReturn),
        daysLeftToReturn,
        returnWindowExpired,
        items,
    };
};

interface GuestContact {
    name: string;
    email: string;
    phone: string;
}

const buildPendingOrder = async (
    payload: CreateOrderInput,
    contact: { name?: string | null; email?: string | null },
    identity: { userId: bigint; guest?: undefined } | { userId?: undefined; guest: GuestContact }
) => {
    const productIds = payload.items.map((i) => BigInt(i.productId));

    const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
    });

    const productMap = new Map(products.map((p) => [p.id.toString(), p]));

    let subtotal = 0;
    const items: OrderItemSnapshot[] = [];
    for (const item of payload.items) {
        const product = productMap.get(item.productId);
        if (!product || product.status !== PRODUCT_STATUS.APPROVED) {
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

export const createOrder = (userId: bigint, payload: CreateOrderInput, user: { name?: string | null; email?: string | null }) =>
    buildPendingOrder(payload, user, { userId });

export const createGuestOrder = (payload: CreateOrderInput, guest: GuestContact) =>
    buildPendingOrder(payload, { name: guest.name, email: guest.email }, { guest });

const findPendingOrder = async (where: Prisma.PendingShopOrderWhereInput) => {
    const pending = await prisma.pendingShopOrder.findFirst({
        where,
        include: { orderGroup: { include: { orderItems: { include: { product: true } } } } },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    const orderItemIds = pending.orderGroup?.orderItems.map((item) => item.id) ?? [];
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
    const orderGroup = await prisma.orderGroup.findFirst({
        where: { refNo, userId },
        include: { orderItems: { include: { product: true } } },
    });

    if (!orderGroup) {
        throw new AppError('Order not found', 404);
    }

    if (orderGroup.status !== ORDER_GROUP_STATUSES.DELIVERED) {
        throw new AppError('Only delivered orders can be returned', 400);
    }

    if (!orderGroup.deliveredAt || !isWithinReturnWindow(orderGroup.deliveredAt)) {
        throw new AppError(`The return window (${SHOP_RETURN_WINDOW_DAYS} days after delivery) for this order has passed`, 400);
    }

    const requestedItemIds = payload.orderItemIds.map((id) => BigInt(id));
    const selectedItems = orderGroup.orderItems.filter((item) => requestedItemIds.some((id) => id === item.id));

    if (selectedItems.length !== requestedItemIds.length) {
        throw new AppError('One or more selected items do not belong to this order', 400);
    }

    for (const item of selectedItems) {
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

    const refundedAmount = selectedItems.reduce((sum, item) => sum + item.quantity * Number(item.price), 0);

    const orderReturn = await prisma.$transaction(async (tx) => {
        const created = await tx.orderReturn.create({
            data: {
                orderGroupId: orderGroup.id,
                userId,
                reason: payload.reason,
                bankName: payload.bankName,
                accountNumber: payload.accountNumber,
                status: ORDER_RETURN_STATUSES.PENDING,
                refundedAmount,
            },
        });

        await tx.orderReturnItem.createMany({
            data: selectedItems.map((item) => ({
                orderReturnId: created.id,
                orderItemId: item.id,
                quantity: item.quantity,
                price: item.price,
            })),
        });

        return created;
    });

    return {
        id: orderReturn.id.toString(),
        status: 'pending',
        refundedAmount: Number(orderReturn.refundedAmount),
        reason: orderReturn.reason,
        createdAt: orderReturn.createdAt,
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
        include: { orderGroup: true },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    if (!pending.orderGroup) {
        throw new AppError('This order has not been confirmed yet and cannot be cancelled', 400);
    }

    if (pending.orderGroup.status !== ORDER_GROUP_STATUSES.PENDING) {
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
        await tx.orderGroup.update({
            where: { id: pending.orderGroup!.id },
            data: { status: ORDER_GROUP_STATUSES.CANCELLED },
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
        include: { orderGroup: true },
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
                ...(shippingStatus ? { orderGroup: { status: SHIPPING_STATUS_TO_ORDER_GROUP_STATUS[shippingStatus] } } : {}),
            },
            include: { orderGroup: true },
            orderBy: { createdAt: 'desc' },
        },
        { page, limit }
    );

    return {
        ...result,
        data: result.data.map((p) => serializePendingOrder(p)),
    };
};
