import { prisma, Prisma, WalletType, LoanStatus } from "../config/prisma.js";
import { logger } from "../utils/logger";
import { CommissionLogService, CommissionLogType } from "./commission_log.service.js";

interface CommissionContext {
    sourceUserId: bigint;
    reference: string | null;
    processedVia: string;
}

export class FundReferralsService {
    private static INDIRECT_AMOUNT = 0.02;
    private static CHAIN_AMOUNT = 0.01;
    private static MAX_CHAIN_DEPTH = 8;

    // Simplistic in-memory cache for commission price as requested by TTL in PHP
    private static commissionPriceCache: { value: number; expiresAt: number } | null = null;
    private static CACHE_TTL_MS = 3600 * 1000;

    static async handle(userId: bigint, referralId: bigint, source?: string | null, reference?: string | null): Promise<void> {
        const ctx: CommissionContext = {
            sourceUserId: userId,
            reference: reference ?? null,
            processedVia: source ? `${source}->queue:referralQueue` : 'queue:referralQueue',
        };

        try {
            // We use a transaction to ensure all wallet updates and loan logic apply atomically
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                const referral = await tx.user.findUnique({ where: { id: referralId } });

                if (!user || !referral) {
                    await CommissionLogService.failed({
                        recipientId: referralId,
                        sourceUserId: userId,
                        type: 'direct_referral',
                        reason: !user
                            ? `Activating user ${userId} record not found when processing referral commission`
                            : `Referrer ${referralId} record not found (deleted or invalid referral_id)`,
                        reference: ctx.reference,
                        processedVia: ctx.processedVia,
                        tx,
                    });
                    return;
                }

                await this.processDirectReferral(tx, referral, ctx);
                await this.processReferralChain(tx, user, referral, ctx);
                await this.updateReferralStatus(tx, referral);
            }, {
                maxWait: 5000,
                timeout: 20000,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('[FundReferralsListener] failed', {
                user_id: userId,
                referral_id: referralId,
                error: message
            });

            await CommissionLogService.failed({
                recipientId: referralId,
                sourceUserId: userId,
                type: 'direct_referral',
                reason: `Unhandled error while processing referral commission: ${message}`,
                reference: ctx.reference,
                processedVia: ctx.processedVia,
            });
            // Continue execution - don't break the user flow, same as PHP
        }
    }

    private static async processDirectReferral(tx: any, referral: any, ctx: CommissionContext): Promise<void> {
        if (referral.blockedAt) {
            await CommissionLogService.skipped({
                recipientId: referral.id,
                sourceUserId: ctx.sourceUserId,
                type: 'direct_referral',
                reason: `Referrer account has been blocked since ${referral.blockedAt.toISOString()}`,
                reference: ctx.reference,
                processedVia: ctx.processedVia,
                tx,
            });
            return;
        }

        const commission = await this.getCommissionPrice(tx);
        const amount = (referral.country && referral.country.toLowerCase() === "nigeria") ? commission : 1;

        await this.creditWallet(tx, referral.id, amount, WalletType.direct, {
            ...ctx,
            commissionType: 'direct_referral',
        });
    }

    private static async processReferralChain(tx: any, user: any, referral: any, ctx: CommissionContext): Promise<void> {
        if (user.isInfant) {
            return;
        }
        if (!referral.referralId) return;

        const currentReferral = await tx.user.findUnique({ where: { id: referral.referralId } });
        if (!currentReferral) {
            await CommissionLogService.failed({
                recipientId: referral.referralId,
                sourceUserId: ctx.sourceUserId,
                type: 'indirect_referral',
                level: 1,
                reason: `Upline referrer ${referral.referralId} record not found (deleted or invalid referral_id)`,
                reference: ctx.reference,
                processedVia: ctx.processedVia,
                tx,
            });
            return;
        }

        // First level
        if (!currentReferral.blockedAt) {
            await this.creditWallet(tx, currentReferral.id, this.INDIRECT_AMOUNT, WalletType.indirect, {
                ...ctx,
                commissionType: 'indirect_referral',
                level: 1,
            });
        } else {
            await CommissionLogService.skipped({
                recipientId: currentReferral.id,
                sourceUserId: ctx.sourceUserId,
                type: 'indirect_referral',
                level: 1,
                reason: `Upline referrer account has been blocked since ${currentReferral.blockedAt.toISOString()}`,
                reference: ctx.reference,
                processedVia: ctx.processedVia,
                tx,
            });
        }

        // Process remaining chain levels
        await this.processReferralChainLevels(tx, currentReferral, ctx);
    }

    private static async processReferralChainLevels(tx: any, referral: any, ctx: CommissionContext): Promise<void> {
        let currentReferral = referral;

        for (let level = 0; level < this.MAX_CHAIN_DEPTH; level++) {
            if (!currentReferral.referralId) break;

            const nextReferral = await tx.user.findUnique({ where: { id: currentReferral.referralId } });
            if (!nextReferral) {
                await CommissionLogService.failed({
                    recipientId: currentReferral.referralId,
                    sourceUserId: ctx.sourceUserId,
                    type: 'chain_referral',
                    level: level + 2,
                    reason: `Chain referrer ${currentReferral.referralId} record not found (deleted or invalid referral_id)`,
                    reference: ctx.reference,
                    processedVia: ctx.processedVia,
                    tx,
                });
                break;
            }
            currentReferral = nextReferral;

            if (!currentReferral.blockedAt) {
                await this.creditWallet(tx, currentReferral.id, this.CHAIN_AMOUNT, WalletType.indirect, {
                    ...ctx,
                    commissionType: 'chain_referral',
                    level: level + 2,
                });
            } else {
                await CommissionLogService.skipped({
                    recipientId: currentReferral.id,
                    sourceUserId: ctx.sourceUserId,
                    type: 'chain_referral',
                    level: level + 2,
                    reason: `Chain referrer account has been blocked since ${currentReferral.blockedAt.toISOString()}`,
                    reference: ctx.reference,
                    processedVia: ctx.processedVia,
                    tx,
                });
            }
        }
    }

    private static async updateReferralStatus(tx: any, referral: any): Promise<void> {
        await tx.user.update({
            where: { id: referral.id },
            data: { referralActivateAt: new Date() }
        });
    }

    private static async getCommissionPrice(tx: any): Promise<number> {
        const now = Date.now();
        if (this.commissionPriceCache && this.commissionPriceCache.expiresAt > now) {
            return this.commissionPriceCache.value;
        }

        const setting = await tx.setting.findUnique({ where: { key: 'commission_price' } });
        const commission = setting ? parseFloat(setting.value) || 0 : 0;

        this.commissionPriceCache = {
            value: commission,
            expiresAt: now + this.CACHE_TTL_MS
        };

        return commission;
    }

    private static async creditWallet(
        tx: any,
        userId: bigint,
        amount: number,
        type: typeof WalletType[keyof typeof WalletType],
        logCtx: CommissionContext & { commissionType: CommissionLogType; level?: number }
    ): Promise<void> {
        const isOwing = await this.isUserOwing(tx, userId);
        if (!isOwing) {
            await this.directWalletCredit(tx, userId, amount, type, logCtx);
            return;
        }

        await this.processLoanRepayment(tx, userId, amount, type, logCtx);
    }

    private static async isUserOwing(tx: any, userId: bigint): Promise<boolean> {
        const result: { count: bigint }[] = await tx.$queryRaw`
            SELECT COUNT(*) as count FROM loans
            WHERE user_id = ${userId}
              AND status IN (${LoanStatus.pending}, ${LoanStatus.granted})
              AND quantity_granted > quantity_repaid
              AND quantity_granted != 0
              AND isPaid = true
        `;
        const firstRow = result[0];
        return firstRow ? firstRow.count > 0 : false;
    }

    private static async directWalletCredit(
        tx: any,
        userId: bigint,
        amount: number,
        type: typeof WalletType[keyof typeof WalletType],
        logCtx: CommissionContext & { commissionType: CommissionLogType; level?: number; successReason?: string; successMetadata?: Record<string, unknown> }
    ): Promise<void> {
        const wallet = await tx.wallet.findFirst({
            where: { userId, type }
        });

        if (!wallet) {
            logger.warn('[FundReferralsService] No wallet found for credit', { userId, type, amount });
            await CommissionLogService.failed({
                recipientId: userId,
                sourceUserId: logCtx.sourceUserId,
                type: logCtx.commissionType,
                level: logCtx.level ?? null,
                amount,
                walletType: type,
                reason: `No ${type} wallet exists for this recipient to credit`,
                reference: logCtx.reference,
                processedVia: logCtx.processedVia,
                tx,
            });
            return;
        }

        await tx.wallet.update({
            where: { id: wallet.id },
            data: { amount: { increment: amount } }
        });

        await CommissionLogService.success({
            recipientId: userId,
            sourceUserId: logCtx.sourceUserId,
            type: logCtx.commissionType,
            level: logCtx.level ?? null,
            amount,
            walletType: type,
            reference: logCtx.reference,
            processedVia: logCtx.processedVia,
            reason: logCtx.successReason ?? null,
            metadata: logCtx.successMetadata ?? null,
            tx,
        });
    }

    private static async processLoanRepayment(
        tx: any,
        userId: bigint,
        amount: number,
        type: typeof WalletType[keyof typeof WalletType],
        logCtx: CommissionContext & { commissionType: CommissionLogType; level?: number }
    ): Promise<void> {
        const loan = await this.getActiveLoan(tx, userId);

        if (!loan) {
            await this.directWalletCredit(tx, userId, amount, type, logCtx);
            return;
        }

        const loanAmountLeft = loan.quantityGranted - loan.quantityRepaid;
        const gkwthAmount = this.calculateGkwthAmount(amount, type, loan.gkwthPrice || 1); // fallback to 1 to avoid div by 0

        if (gkwthAmount > loanAmountLeft) {
            await this.processExcessPayment(tx, userId, loan, gkwthAmount, loanAmountLeft, type, amount, logCtx);
        } else {
            await tx.loan.update({
                where: { id: loan.id },
                data: { quantityRepaid: { increment: gkwthAmount } }
            });

            await CommissionLogService.success({
                recipientId: userId,
                sourceUserId: logCtx.sourceUserId,
                type: logCtx.commissionType,
                level: logCtx.level ?? null,
                amount,
                walletType: type,
                reference: logCtx.reference,
                processedVia: logCtx.processedVia,
                reason: `Commission was not added to wallet balance - it was applied to repay outstanding loan #${loan.id} instead (${gkwthAmount} of ${loanAmountLeft} remaining balance repaid)`,
                metadata: { appliedToLoan: true, loanId: loan.id.toString(), loanAmountRepaid: gkwthAmount, loanAmountLeftBefore: loanAmountLeft },
                tx,
            });
        }
    }

    private static async getActiveLoan(tx: any, userId: bigint) {
        // Fetch the first granted loan where quantityGranted > quantityRepaid
        // using Prisma raw query since column-to-column comparison isn't fully supported via Prisma's typed API yet
        const loans: any[] = await tx.$queryRaw`
            SELECT id, quantity_granted as quantityGranted, quantity_repaid as quantityRepaid, gkwth_price as gkwthPrice
            FROM loans
            WHERE user_id = ${userId}
              AND status = 'granted'
              AND quantity_granted > quantity_repaid
            ORDER BY created_at DESC
            LIMIT 1
        `;

        return loans.length > 0 ? loans[0] : null;
    }

    private static calculateGkwthAmount(amount: number, type: typeof WalletType[keyof typeof WalletType], gkwthPrice: number): number {
        return type === WalletType.indirect
            ? amount
            : Math.round((amount / gkwthPrice) * 100) / 100; // round to 2 decimal places
    }

    private static async processExcessPayment(
        tx: any,
        userId: bigint,
        loan: any,
        gkwthAmount: number,
        loanAmountLeft: number,
        type: typeof WalletType[keyof typeof WalletType],
        originalAmount: number,
        logCtx: CommissionContext & { commissionType: CommissionLogType; level?: number }
    ): Promise<void> {
        const excessAmount = gkwthAmount - loanAmountLeft;
        const gkwthPrice = loan.gkwthPrice || 1;
        const walletCredit = Math.round((excessAmount * gkwthPrice) * 100) / 100;

        // Repay remaining loan
        await tx.loan.update({
            where: { id: loan.id },
            data: { quantityRepaid: { increment: loanAmountLeft } }
        });

        // Credit excess to wallet
        await this.directWalletCredit(tx, userId, walletCredit, type, {
            ...logCtx,
            successReason: `Commission of ${originalAmount} fully repaid loan #${loan.id} (${loanAmountLeft} owed); remainder credited to wallet`,
            successMetadata: { appliedToLoan: true, loanId: loan.id.toString(), loanAmountRepaid: loanAmountLeft, excessCreditedToWallet: walletCredit },
        });

        // Update user permissions
        await this.updateUserPermissions(tx, userId);
    }

    private static async updateUserPermissions(tx: any, userId: bigint): Promise<void> {
        await tx.user.update({
            where: { id: userId },
            data: {
                canWithdraw: true,
                canOptOut: true,
                canWithdrawGkwth: true
            }
        });
    }
}
