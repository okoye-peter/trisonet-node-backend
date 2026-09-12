import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma, Prisma, WalletType } from "../config/prisma.js";
import { ROLES, ORDER_GROUP_STATUSES, ORDER_RETURN_STATUSES, SHOP_RETURN_WINDOW_DAYS } from "../config/constants.js";
import { AppError } from "../utils/AppError.js";
import { getSetting } from "./setting.service.js";
import { CommissionLogService } from "./commission_log.service.js";

const COMMISSION_PERCENTAGE_KEY = 'store_invite_commission_percentage';
const UPGRADE_WINDOW_DAYS_KEY = 'store_invite_upgrade_window_days';
const SETTINGS_TTL_MS = 3600 * 1000;
const PROCESSED_VIA = 'cron:processStoreInviteCommissionsForDeliveredOrders';
const STORE_INVITE_COMMISSION_BATCH_LIMIT = 50;

interface RegisterGuestInput {
    name: string;
    email: string;
    phone: string;
    password: string;
    inviteCode: string;
}

export class StoreGuestService {
    static async getCommissionPercentage(): Promise<number> {
        const value = await getSetting(COMMISSION_PERCENTAGE_KEY, SETTINGS_TTL_MS);
        return value ? parseFloat(value) || 0 : 0;
    }

    static async getUpgradeWindowDays(): Promise<number> {
        const value = await getSetting(UPGRADE_WINDOW_DAYS_KEY, SETTINGS_TTL_MS);
        return value ? parseFloat(value) || 0 : 0;
    }

    /**
     * Any activated user (any role) may invite people to the store. Lazily
     * generates the code on first request and persists it.
     */
    static async getOrCreateInviteCode(ownerId: bigint): Promise<string> {
        const owner = await prisma.user.findUnique({
            where: { id: ownerId },
            select: { id: true, status: true, storeInviteCode: true },
        });

        if (!owner) throw new AppError('User not found', 404);
        if (!owner.status) throw new AppError('Your account must be activated before you can invite people to the store', 403);
        if (owner.storeInviteCode) return owner.storeInviteCode;

        for (let attempt = 0; attempt < 5; attempt++) {
            const code = crypto.randomBytes(6).toString('hex');
            try {
                await prisma.user.update({ where: { id: ownerId }, data: { storeInviteCode: code } });
                return code;
            } catch (err) {
                if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
                throw err;
            }
        }

        throw new AppError('Failed to generate a unique invite code, please try again', 500);
    }

    static async resolveInviteOwner(code: string) {
        return prisma.user.findFirst({
            where: { storeInviteCode: code, status: true, deletedAt: null },
            select: { id: true, name: true },
        });
    }

    /**
     * Lean, standalone registration path for store-only guests - deliberately does not
     * reuse customer_registration.service.ts::createUser, which triggers referral/region/
     * patron-sponsorship side effects a guest must not get.
     */
    static async registerGuest(data: RegisterGuestInput) {
        const owner = await this.resolveInviteOwner(data.inviteCode);
        if (!owner) throw new AppError('Invalid or expired invite code', 400);

        const existingUser = await prisma.user.findFirst({
            where: { OR: [{ email: data.email }, { phone: data.phone }] },
            select: { email: true, phone: true },
        });

        if (existingUser) {
            if (existingUser.email === data.email) throw new AppError('Email already in use', 400);
            if (existingUser.phone === data.phone) throw new AppError('Phone number already in use', 400);
        }

        const hashedPassword = await bcrypt.hash(data.password, 12);
        const username = `guest_${data.email.split('@')[0]}${crypto.randomInt(1000, 9999)}`.toLowerCase();

        try {
            return await prisma.user.create({
                data: {
                    name: data.name,
                    username,
                    email: data.email,
                    phone: data.phone,
                    password: hashedPassword,
                    role: ROLES.STORE_GUEST,
                    invitedById: owner.id,
                },
            });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw new AppError('An account with this email or phone number already exists', 400);
            }
            throw err;
        }
    }

    /**
     * Cron entry point - see backend/src/cron.ts::processStoreInviteCommissions.
     *
     * Commission is deliberately NOT paid at payment-confirmation time. It's paid only once
     * an order has been delivered AND the SHOP_RETURN_WINDOW_DAYS return window has fully
     * closed - at which point OrderReturnController::store() (PHP) can no longer accept new
     * return requests for it, so the order's return outcome is final (or as good as final -
     * see the pending-hold below). This means an inviter never gets paid commission on an
     * order that then gets refunded.
     *
     * invitedById is set once at store-guest registration and is never cleared on upgrade
     * (see the upgrade-completion hook in AccountActivationService.activateUserAccountOptimized),
     * so the inviter keeps earning this indefinitely - during the guest period AND after the
     * buyer upgrades to a full account - on top of, not instead of, the normal one-time
     * referral commission the upgrade itself triggers.
     */
    static async processStoreInviteCommissionsForDeliveredOrders(): Promise<{ processed: number; held: number }> {
        const cutoff = new Date(Date.now() - SHOP_RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

        // Bounded like every other batch cron job in cron.ts - this runs every 5 minutes,
        // so a backlog (a held/pending order, downtime, etc.) still clears quickly without
        // ever pulling in the store's entire delivered-order history on one tick.
        const candidates = await prisma.orderGroup.findMany({
            where: {
                status: ORDER_GROUP_STATUSES.DELIVERED,
                deliveredAt: { lte: cutoff },
            },
            select: { id: true, refNo: true, userId: true, deliveredAt: true },
            orderBy: { deliveredAt: 'asc' },
            take: STORE_INVITE_COMMISSION_BATCH_LIMIT,
        });

        let processed = 0;
        let held = 0;

        for (const orderGroup of candidates) {
            // Idempotency: this order's commission decision (paid or skipped) has already
            // been recorded - never re-process it. reference is the order's own refNo,
            // unique per order, set below on both the success and skip paths.
            const alreadyProcessed = await prisma.commissionLog.findFirst({
                where: { type: 'store_invite', reference: orderGroup.refNo },
                select: { id: true },
            });
            if (alreadyProcessed) continue;

            if (!orderGroup.userId) continue;

            // A return request can only be *filed* within the window we've just confirmed
            // has closed, but an admin may not have reviewed it yet - hold this order and
            // retry on a later cron tick rather than risk paying commission on an order
            // that's about to be refunded.
            const hasPendingReturn = await prisma.orderReturn.findFirst({
                where: { orderGroupId: orderGroup.id, status: ORDER_RETURN_STATUSES.PENDING },
                select: { id: true },
            });
            if (hasPendingReturn) {
                held++;
                continue;
            }

            await prisma.$transaction(async (tx) => {
                const buyer = await tx.user.findUnique({
                    where: { id: orderGroup.userId! },
                    select: { id: true, invitedById: true },
                });

                // No store-invite relationship on this buyer at all - most orders in the
                // store will hit this. Still log it (as `skipped`, not silently returning)
                // so the idempotency check above stops re-scanning this order on every
                // future cron tick - without a log row here, an ever-growing set of
                // never-invited delivered orders would get re-queried forever.
                if (!buyer || !buyer.invitedById) {
                    await CommissionLogService.skipped({
                        sourceUserId: buyer?.id ?? orderGroup.userId!,
                        type: 'store_invite',
                        reference: orderGroup.refNo,
                        processedVia: PROCESSED_VIA,
                        reason: 'Buyer was not invited via a store-invite link - no commission applicable',
                        tx,
                    });
                    return;
                }

                const orderTransaction = await tx.orderTransaction.findFirst({
                    where: { orderGroupId: orderGroup.id },
                    select: { amount: true },
                });
                const paidAmount = Number(orderTransaction?.amount ?? 0);

                const approvedReturns = await tx.orderReturn.findMany({
                    where: { orderGroupId: orderGroup.id, status: ORDER_RETURN_STATUSES.APPROVED },
                    select: { refundedAmount: true },
                });
                const refundedAmount = approvedReturns.reduce((sum, r) => sum + Number(r.refundedAmount ?? 0), 0);
                const effectiveAmount = Math.max(0, paidAmount - refundedAmount);

                const inviter = await tx.user.findUnique({
                    where: { id: buyer.invitedById },
                    select: { id: true, blockedAt: true, deletedAt: true },
                });

                if (!inviter || inviter.blockedAt || inviter.deletedAt) {
                    await CommissionLogService.skipped({
                        recipientId: buyer.invitedById,
                        sourceUserId: buyer.id,
                        type: 'store_invite',
                        reference: orderGroup.refNo,
                        processedVia: PROCESSED_VIA,
                        reason: !inviter
                            ? `Inviter ${buyer.invitedById} record not found`
                            : `Inviter account is blocked or deleted`,
                        tx,
                    });
                    return;
                }

                if (effectiveAmount <= 0) {
                    await CommissionLogService.skipped({
                        recipientId: inviter.id,
                        sourceUserId: buyer.id,
                        type: 'store_invite',
                        reference: orderGroup.refNo,
                        processedVia: PROCESSED_VIA,
                        reason: `Order was fully refunded (paid=${paidAmount}, refunded=${refundedAmount}) - nothing to pay commission on`,
                        metadata: { orderGroupId: orderGroup.id.toString(), paidAmount, refundedAmount },
                        tx,
                    });
                    return;
                }

                const percentage = await this.getCommissionPercentage();
                const amount = Math.round(effectiveAmount * percentage / 100 * 100) / 100;

                if (percentage <= 0 || amount <= 0) {
                    await CommissionLogService.skipped({
                        recipientId: inviter.id,
                        sourceUserId: buyer.id,
                        type: 'store_invite',
                        reference: orderGroup.refNo,
                        processedVia: PROCESSED_VIA,
                        reason: `Commission percentage is not configured or resolves to zero (percentage=${percentage})`,
                        tx,
                    });
                    return;
                }

                await tx.wallet.upsert({
                    where: { userId_type: { userId: inviter.id, type: WalletType.shopping } },
                    update: { amount: { increment: amount } },
                    create: { userId: inviter.id, type: WalletType.shopping, amount },
                });

                await CommissionLogService.success({
                    recipientId: inviter.id,
                    sourceUserId: buyer.id,
                    type: 'store_invite',
                    amount,
                    walletType: WalletType.shopping,
                    reference: orderGroup.refNo,
                    processedVia: PROCESSED_VIA,
                    metadata: {
                        orderGroupId: orderGroup.id.toString(),
                        percentage,
                        paidAmount,
                        refundedAmount,
                        effectiveAmount,
                    },
                    tx,
                });
            });

            processed++;
        }

        return { processed, held };
    }

    static async requestUpgrade(guestUserId: bigint) {
        const guest = await prisma.user.findUnique({ where: { id: guestUserId } });
        if (!guest) throw new AppError('User not found', 404);
        if (Number(guest.role) !== ROLES.STORE_GUEST) throw new AppError('Only store guest accounts can request an upgrade', 400);
        if (guest.status) throw new AppError('Your account is already fully activated', 400);

        const existing = await prisma.storeGuestUpgradeRequest.findFirst({
            where: { userId: guestUserId, status: 'pending' },
        });
        if (existing) return existing;

        const days = await this.getUpgradeWindowDays();
        const deadlineAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        return prisma.storeGuestUpgradeRequest.create({
            data: { userId: guestUserId, deadlineAt },
        });
    }

    static async getUpgradeRequest(guestUserId: bigint) {
        return prisma.storeGuestUpgradeRequest.findFirst({
            where: { userId: guestUserId, status: 'pending' },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Cron entry point - see backend/src/cron.ts::expireStoreGuestUpgrades.
     * Guests who never ordered are hard-deleted (no FK will block it). Guests with order
     * or commission history are irreversibly soft-deleted instead: login blocked via
     * deletedAt (the same field `protect` already checks), PII scrubbed, financial rows
     * (orders, wallets, commission logs) left intact for accounting integrity.
     */
    static async expireLapsedUpgrades(): Promise<{ softDeleted: number; hardDeleted: number }> {
        const lapsed = await prisma.storeGuestUpgradeRequest.findMany({
            where: { status: 'pending', deadlineAt: { lt: new Date() } },
        });

        let softDeleted = 0;
        let hardDeleted = 0;

        for (const req of lapsed) {
            const [orderCount, commissionCount] = await Promise.all([
                prisma.orderGroup.count({ where: { userId: req.userId } }),
                prisma.commissionLog.count({ where: { sourceUserId: req.userId } }),
            ]);

            if (orderCount === 0 && commissionCount === 0) {
                await prisma.$transaction(async (tx) => {
                    await tx.storeGuestUpgradeRequest.deleteMany({ where: { userId: req.userId } });
                    await tx.wallet.deleteMany({ where: { userId: req.userId } });
                    await tx.user.delete({ where: { id: req.userId } });
                });
                hardDeleted++;
            } else {
                await prisma.$transaction(async (tx) => {
                    await tx.storeGuestUpgradeRequest.update({
                        where: { id: req.id },
                        data: { status: 'expired', expiredAt: new Date() },
                    });
                    await tx.user.update({
                        where: { id: req.userId },
                        data: {
                            deletedAt: new Date(),
                            name: 'Deleted Store Guest',
                            email: null,
                            phone: null,
                            pictureUrl: null,
                            storeInviteCode: null,
                            refreshToken: null,
                            password: crypto.randomBytes(32).toString('hex'),
                        },
                    });
                });
                softDeleted++;
            }
        }

        return { softDeleted, hardDeleted };
    }
}
