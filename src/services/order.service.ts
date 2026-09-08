import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { SHOP_DELIVERY_FEE, PRODUCT_STATUS } from "../config/constants";
import { PagaService } from "./paga.service";
import { paginate } from "../utils/pagination";

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

// A checkout only ever produces a PendingShopOrder row — see PaymentService.processShopOrderPayment
// for where the real OrderGroup/OrderItem/OrderTransaction rows get created once payment is
// confirmed. Every order the buyer can see, paid or not, is read back through this row.
const serializePendingOrder = (pending: any) => {
    const shipping = (pending.shipping ?? null) as (ShippingInput & { paymentMethod?: string }) | null;
    const items = (pending.items ?? []) as OrderItemSnapshot[];

    return {
        id: pending.id.toString(),
        refNo: pending.refNo,
        status: true,
        shipping,
        deliveryFee: SHOP_DELIVERY_FEE,
        total: Number(pending.amount),
        createdAt: pending.createdAt,
        paymentStatus: pending.status,
        paymentReference: pending.paymentReference,
        virtualAccount: pending.paymentDetails ?? undefined,
        items: items.map((item, index) => ({
            id: `${pending.id}-${index}`,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            product: { id: item.productId, name: item.name, image: item.image },
        })),
    };
};

export const createOrder = async (userId: bigint, payload: CreateOrderInput, user: { name?: string | null; email?: string | null }) => {
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

    const total = subtotal + SHOP_DELIVERY_FEE;
    const refNo = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const paymentReference = pagaService.generateReference('ORDER');

    const virtualAccountResult = await pagaService.generateVirtualAccount(
        total,
        payload.shipping.fullName || user.name || 'Customer',
        payload.shipping.phone,
        paymentReference,
        user.email || undefined
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
            userId,
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

export const getOrderByRefNo = async (refNo: string, userId: bigint) => {
    const pending = await prisma.pendingShopOrder.findFirst({
        where: { refNo, userId },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    return serializePendingOrder(pending);
};

export const getOrderStatus = async (refNo: string, userId: bigint) => {
    const pending = await prisma.pendingShopOrder.findFirst({
        where: { refNo, userId },
        select: { status: true },
    });

    if (!pending) {
        throw new AppError('Order not found', 404);
    }

    return { status: pending.status };
};

export const getOrdersForUser = async (userId: bigint, page?: number, limit?: number) => {
    const result = await paginate(
        prisma.pendingShopOrder,
        {
            where: { userId },
            orderBy: { createdAt: 'desc' },
        },
        { page, limit }
    );

    return {
        ...result,
        data: result.data.map(serializePendingOrder),
    };
};
