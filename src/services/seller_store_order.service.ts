import { prisma, Prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { paginate } from "../utils/pagination";
import { ORDER_DELIVERY_DAYS, ORDER_GROUP_STATUSES } from "../config/constants";
import { combinedDelivery } from "./order.service";

export type SellerOrderStatus = 'cancelled' | 'pending' | 'shipped' | 'delivered';

const STATUS_TEXT: Record<number, SellerOrderStatus> = {
    [ORDER_GROUP_STATUSES.CANCELLED]: 'cancelled',
    [ORDER_GROUP_STATUSES.PENDING]: 'pending',
    [ORDER_GROUP_STATUSES.SHIPPED]: 'shipped',
    [ORDER_GROUP_STATUSES.DELIVERED]: 'delivered',
};

const STATUS_BY_TEXT: Record<SellerOrderStatus, number> = {
    cancelled: ORDER_GROUP_STATUSES.CANCELLED,
    pending: ORDER_GROUP_STATUSES.PENDING,
    shipped: ORDER_GROUP_STATUSES.SHIPPED,
    delivered: ORDER_GROUP_STATUSES.DELIVERED,
};

/**
 * The only move a seller can make. Delivered is set by an admin in PHP
 * (OrderGroupController@updateStatus) after calling the courier the seller named, and
 * cancelling stays there too because it refunds the buyer, restocks and cancels the payout.
 */
const NEXT_STATUS: Partial<Record<SellerOrderStatus, SellerOrderStatus>> = {
    pending: 'shipped',
};

const orderInclude = {
    orderItems: { include: { product: { select: { name: true, image: true } } } },
    sellerPayout: { select: { grossAmount: true, commissionRate: true, commissionAmount: true, netAmount: true, status: true } },
    user: { select: { name: true, phone: true } },
    checkout: { select: { refNo: true, guestName: true, guestPhone: true } },
} satisfies Prisma.OrderGroupInclude;

type OrderWithRelations = Prisma.OrderGroupGetPayload<{ include: typeof orderInclude }>;

const parseShipping = (address: string) => {
    try {
        return JSON.parse(address) as { fullName?: string; phone?: string; address?: string; city?: string; state?: string };
    } catch {
        return { address };
    }
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each part must be delivered within ORDER_DELIVERY_DAYS of payment (when the group was created). */
export const deliveryDeadline = (createdAt: Date | null, status: number) => {
    const deliverBy = new Date((createdAt ?? new Date()).getTime() + ORDER_DELIVERY_DAYS * DAY_MS);
    const open = status === ORDER_GROUP_STATUSES.PENDING || status === ORDER_GROUP_STATUSES.SHIPPED;
    const msLeft = deliverBy.getTime() - Date.now();
    return {
        deliverBy: open ? deliverBy : null,
        // Rounded up, so the last few hours still read as "1 day left".
        daysLeftToDeliver: open && msLeft > 0 ? Math.ceil(msLeft / DAY_MS) : null,
        isOverdue: open && msLeft <= 0,
    };
};

const serializeOrder = (group: OrderWithRelations) => {
    const shipping = parseShipping(group.address);
    const status = STATUS_TEXT[group.status] ?? 'pending';
    const items = group.orderItems.map((item) => ({
        id: item.id.toString(),
        productId: item.productId.toString(),
        name: item.product.name,
        image: item.product.image,
        quantity: item.quantity,
        price: Number(item.price),
    }));
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return {
        id: group.id.toString(),
        refNo: group.refNo,
        status,
        nextStatus: NEXT_STATUS[status] ?? null,
        items,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        total: Math.round(total * 100) / 100,
        payout: group.sellerPayout
            ? {
                gross: Number(group.sellerPayout.grossAmount),
                commissionRate: Number(group.sellerPayout.commissionRate),
                commission: Number(group.sellerPayout.commissionAmount),
                net: Number(group.sellerPayout.netAmount),
                status: group.sellerPayout.status,
            }
            : null,
        buyer: {
            name: shipping.fullName || group.user?.name || group.checkout?.guestName || 'Customer',
            phone: shipping.phone || group.user?.phone || group.checkout?.guestPhone || null,
        },
        deliveryAddress: [shipping.address, shipping.city, shipping.state].filter(Boolean).join(', ') || null,
        courier: group.courierName ? { name: group.courierName, phone: group.courierPhone } : null,
        shippedAt: group.shippedAt,
        deliveredAt: group.deliveredAt,
        ...deliveryDeadline(group.createdAt, group.status),
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
    };
};

export class SellerStoreOrderService {
    /** Any store the user owns, whatever its status - a suspended seller still has paid orders to fulfil. */
    private static async getStore(user: any) {
        const store = await prisma.sellerStore.findUnique({ where: { userId: user.id }, select: { id: true } });
        if (!store) throw new AppError('You do not have a store yet', 403);
        return store;
    }

    private static async getOwnOrder(storeId: bigint, refNo: string) {
        const group = await prisma.orderGroup.findFirst({ where: { refNo, sellerStoreId: storeId }, include: orderInclude });
        if (!group) throw new AppError('Order not found', 404);
        return group;
    }

    static async list(
        user: any,
        { page, limit, status, search }: { page?: number | undefined; limit?: number | undefined; status?: string | undefined; search?: string | undefined },
    ) {
        const store = await this.getStore(user);
        const where: Prisma.OrderGroupWhereInput = { sellerStoreId: store.id };
        if (status) where.status = STATUS_BY_TEXT[status as SellerOrderStatus];
        const term = search?.trim();
        if (term) where.refNo = { contains: term };

        const [result, counts] = await Promise.all([
            paginate(prisma.orderGroup, { where, include: orderInclude, orderBy: { createdAt: 'desc' } }, { page, limit }),
            prisma.orderGroup.groupBy({ by: ['status'], where: { sellerStoreId: store.id }, _count: { _all: true } }),
        ]);

        const statusCounts: Record<SellerOrderStatus, number> = { pending: 0, shipped: 0, delivered: 0, cancelled: 0 };
        for (const row of counts) {
            const key = STATUS_TEXT[row.status];
            if (key) statusCounts[key] = row._count._all;
        }

        return { ...result, data: (result.data as OrderWithRelations[]).map(serializeOrder), statusCounts };
    }

    static async get(user: any, refNo: string) {
        const store = await this.getStore(user);
        return serializeOrder(await this.getOwnOrder(store.id, refNo));
    }

    /**
     * Marks a pending order shipped with the courier's contact details. Calling it again
     * while the order is still shipped only corrects the courier details.
     */
    static async markShipped(user: any, refNo: string, courier: { name: string; phone: string }) {
        const store = await this.getStore(user);
        const group = await this.getOwnOrder(store.id, refNo);
        const current = STATUS_TEXT[group.status] ?? 'pending';

        if (current !== 'pending' && current !== 'shipped') {
            throw new AppError(current === 'cancelled' ? 'This order was cancelled' : 'This order is already delivered', 400);
        }

        // Conditional on the status we read, so a concurrent admin change (e.g. a cancel) wins.
        const moved = await prisma.orderGroup.updateMany({
            where: { id: group.id, status: group.status },
            data: {
                status: ORDER_GROUP_STATUSES.SHIPPED,
                courierName: courier.name,
                courierPhone: courier.phone,
                ...(current === 'pending' ? { shippedAt: new Date() } : {}),
            },
        });
        if (moved.count === 0) throw new AppError('This order was just updated. Refresh and try again.', 409);

        if (current === 'pending') await this.notifyBuyer(group);

        return serializeOrder(await this.getOwnOrder(store.id, refNo));
    }

    /**
     * The buyer sees one combined order (see OrderService.serializePendingOrder), so they
     * hear about it under the checkout's own refNo, and only when the first part leaves a
     * seller. The "delivered" notice is sent by the PHP admin when it marks the last part delivered.
     */
    private static async notifyBuyer(group: OrderWithRelations) {
        if (!group.userId || !group.pendingShopOrderId || !group.checkout) return;

        const parts = await prisma.orderGroup.findMany({
            where: { pendingShopOrderId: group.pendingShopOrderId },
            select: { id: true, status: true, deliveredAt: true },
        });
        // `group` is the part as it was before this update.
        const before = combinedDelivery(parts.map((p) => (p.id === group.id ? { status: group.status, deliveredAt: group.deliveredAt } : p))).status;
        const after = combinedDelivery(parts).status;
        if (before === after || after !== 'shipped') return;

        const ref = group.checkout.refNo;
        try {
            const notification = await prisma.notification.create({
                data: {
                    title: `Order #${ref} ${after}`,
                    body: `Your order #${ref} is on its way.`,
                },
            });
            await prisma.notificationUser.create({ data: { userId: group.userId, notificationId: notification.id } });
        } catch {
            // Best-effort: the status change itself already succeeded.
        }
    }
}
