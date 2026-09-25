import { prisma } from "../config/prisma.js";
import { pagaLogger } from "../utils/logger.js";
import { SELLER_COMMISSION_PERCENTAGE_KEY } from "../config/constants.js";
import { getSetting } from "./setting.service.js";
import { renderOrderItemsHtml } from "./email.service.js";
import { addSellerNewOrderEmailJob, addSmsJob } from "../queue/index.js";

const SETTINGS_TTL_MS = 60 * 1000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const naira = (n: number) => `₦${n.toLocaleString()}`;

/** Admin-set percentage of each partner order the platform keeps (Settings page in PHP). */
export const getSellerCommissionRate = async (): Promise<number> => {
    const value = parseFloat((await getSetting(SELLER_COMMISSION_PERCENTAGE_KEY, SETTINGS_TTL_MS)) ?? '');
    if (!Number.isFinite(value)) return 0;
    return round2(Math.min(Math.max(value, 0), 100));
};

export const computeSellerPayout = (grossAmount: number, commissionRate: number) => {
    const gross = round2(grossAmount);
    const commission = round2(gross * commissionRate / 100);
    return { gross, commission, net: round2(gross - commission) };
};

/**
 * Tells each seller about their newly paid order: in-app notification, email and SMS.
 * Best-effort and called after the payment transaction has committed - a failure here
 * must never undo a confirmed payment. SMS and email delivery can fail silently at the
 * provider, which is why the in-app notification is written first.
 */
export const notifySellersOfNewOrders = async (orderGroupIds: bigint[]) => {
    if (orderGroupIds.length === 0) return;

    const groups = await prisma.orderGroup.findMany({
        where: { id: { in: orderGroupIds }, sellerStoreId: { not: null } },
        include: {
            orderItems: { include: { product: { select: { name: true } } } },
            sellerStore: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
            sellerPayout: { select: { grossAmount: true, netAmount: true } },
            checkout: { select: { shipping: true, guestName: true, guestPhone: true, user: { select: { name: true, phone: true } } } },
        },
    });

    for (const group of groups) {
        const store = group.sellerStore!;
        const seller = store.user;
        const shipping = (group.checkout?.shipping ?? {}) as { fullName?: string; phone?: string; address?: string; city?: string; state?: string };
        const buyerName = shipping.fullName || group.checkout?.user?.name || group.checkout?.guestName || 'Customer';
        const buyerPhone = shipping.phone || group.checkout?.user?.phone || group.checkout?.guestPhone || 'N/A';
        const deliveryAddress = [shipping.address, shipping.city, shipping.state].filter(Boolean).join(', ') || 'N/A';
        const total = Number(group.sellerPayout?.grossAmount ?? 0);
        const payout = Number(group.sellerPayout?.netAmount ?? 0);
        const itemCount = group.orderItems.reduce((sum, item) => sum + item.quantity, 0);

        try {
            const notification = await prisma.notification.create({
                data: {
                    title: `New order #${group.refNo}`,
                    body: `${store.name} has a new paid order: ${itemCount} item(s), ${naira(total)}. Deliver to ${buyerName} (${buyerPhone}), ${deliveryAddress}.`,
                },
            });
            await prisma.notificationUser.create({ data: { userId: seller.id, notificationId: notification.id } });
        } catch (error) {
            pagaLogger.error('failed to create seller new order notification', { orderGroupId: group.id.toString(), error });
        }

        if (seller.email) {
            await addSellerNewOrderEmailJob(seller.email, {
                name: seller.name,
                storeName: store.name,
                orderRef: group.refNo,
                itemsHtml: renderOrderItemsHtml(
                    group.orderItems.map((item) => ({ name: item.product.name, quantity: item.quantity, price: Number(item.price) })),
                    naira,
                ),
                total: naira(total),
                payout: naira(payout),
                buyerName,
                buyerPhone,
                deliveryAddress,
            }).catch((error) => pagaLogger.error('failed to queue seller new order email', { ref: group.refNo, error }));
        }

        const smsTo = store.phone || seller.phone;
        if (smsTo) {
            await addSmsJob(smsTo, `Trisonet: New order #${group.refNo} for ${store.name} - ${itemCount} item(s), ${naira(total)}. Check your store orders to deliver.`)
                .catch((error) => pagaLogger.error('failed to queue seller new order sms', { ref: group.refNo, error }));
        }
    }
};
