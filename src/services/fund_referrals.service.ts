import { prisma, Prisma, WalletType, LoanStatus } from "../config/prisma.js";
import { logger } from "../utils/logger";

export class FundReferralsService {
    private static INDIRECT_AMOUNT = 0.02;
    private static CHAIN_AMOUNT = 0.01;
    private static MAX_CHAIN_DEPTH = 8;

    // Simplistic in-memory cache for commission price as requested by TTL in PHP
    private static commissionPriceCache: { value: number; expiresAt: number } | null = null;
    private static CACHE_TTL_MS = 3600 * 1000;

    static async handle(userId: bigint, referralId: bigint): Promise<void> {
        try {
            // We use a transaction to ensure all wallet updates and loan logic apply atomically
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const user = await tx.user.findUnique({ where: { id: userId } });
                const referral = await tx.user.findUnique({ where: { id: referralId } });

                if (!user || !referral) return;

                await this.processDirectReferral(tx, referral);
                await this.processReferralChain(tx, user, referral);
                await this.updateReferralStatus(tx, referral);
            }, {
                maxWait: 5000,
                timeout: 20000,
            });
        } catch (error) {
            logger.error('[FundReferralsListener] failed', {
                user_id: userId,
                referral_id: referralId,
                error: error instanceof Error ? error.message : String(error)
            });
            // Continue execution - don't break the user flow, same as PHP
        }
    }

    private static async processDirectReferral(tx: any, referral: any): Promise<void> {
        if (referral.blockedAt) return;

        const commission = await this.getCommissionPrice(tx);
        const amount = (referral.country && referral.country.toLowerCase() === "nigeria") ? commission : 1;

        await this.creditWallet(tx, referral.id, amount, WalletType.direct);
    }

    private static async processReferralChain(tx: any, user: any, referral: any): Promise<void> {
        if (user.isInfant || !referral.referralId) return;

        const currentReferral = await tx.user.findUnique({ where: { id: referral.referralId } });
        if (!currentReferral) return;

        // First level
        if (!currentReferral.blockedAt) {
            await this.creditWallet(tx, currentReferral.id, this.INDIRECT_AMOUNT, WalletType.indirect);
        }

        // Process remaining chain levels
        await this.processReferralChainLevels(tx, currentReferral);
    }

    private static async processReferralChainLevels(tx: any, referral: any): Promise<void> {
        let currentReferral = referral;

        for (let level = 0; level < this.MAX_CHAIN_DEPTH; level++) {
            if (!currentReferral.referralId) break;

            currentReferral = await tx.user.findUnique({ where: { id: currentReferral.referralId } });
            if (!currentReferral) break;

            if (!currentReferral.blockedAt) {
                await this.creditWallet(tx, currentReferral.id, this.CHAIN_AMOUNT, WalletType.indirect);
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

    private static async creditWallet(tx: any, userId: bigint, amount: number, type: typeof WalletType[keyof typeof WalletType]): Promise<void> {
        const isOwing = await this.isUserOwing(tx, userId);
        if (!isOwing) {
            await this.directWalletCredit(tx, userId, amount, type);
            return;
        }

        await this.processLoanRepayment(tx, userId, amount, type);
    }

    private static async isUserOwing(tx: any, userId: bigint): Promise<boolean> {
        const result: { count: bigint }[] = await tx.$queryRaw`
            SELECT COUNT(*) as count FROM "loans"
            WHERE "user_id" = ${userId}
              AND "status" IN (${LoanStatus.pending}, ${LoanStatus.granted})
              AND "quantity_granted" > "quantity_repaid"
              AND "quantity_granted" != 0
              AND "isPaid" = true
        `;
        const firstRow = result[0];
        return firstRow ? firstRow.count > 0 : false;
    }

    private static async directWalletCredit(tx: any, userId: bigint, amount: number, type: typeof WalletType[keyof typeof WalletType]): Promise<void> {
        const wallet = await tx.wallet.findFirst({
            where: { userId, type }
        });

        if (wallet) {
            await tx.wallet.update({
                where: { id: wallet.id },
                data: { amount: { increment: amount } }
            });
        }
    }

    private static async processLoanRepayment(tx: any, userId: bigint, amount: number, type: typeof WalletType[keyof typeof WalletType]): Promise<void> {
        const loan = await this.getActiveLoan(tx, userId);

        if (!loan) {
            await this.directWalletCredit(tx, userId, amount, type);
            return;
        }

        const loanAmountLeft = loan.quantityGranted - loan.quantityRepaid;
        const gkwthAmount = this.calculateGkwthAmount(amount, type, loan.gkwthPrice || 1); // fallback to 1 to avoid div by 0

        if (gkwthAmount > loanAmountLeft) {
            await this.processExcessPayment(tx, userId, loan, gkwthAmount, loanAmountLeft, type);
        } else {
            await tx.loan.update({
                where: { id: loan.id },
                data: { quantityRepaid: { increment: gkwthAmount } }
            });
        }
    }

    private static async getActiveLoan(tx: any, userId: bigint) {
        // Fetch the first granted loan where quantityGranted > quantityRepaid
        // using Prisma raw query since column-to-column comparison isn't fully supported via Prisma's typed API yet
        const loans = await tx.$queryRaw`
            SELECT * FROM "loans"
            WHERE "user_id" = ${userId}
              AND "status" = 'granted'
              AND "quantity_granted" > "quantity_repaid"
            ORDER BY "created_at" DESC
            LIMIT 1
        `;

        return loans.length > 0 ? loans[0] : null;
    }

    private static calculateGkwthAmount(amount: number, type: typeof WalletType[keyof typeof WalletType], gkwthPrice: number): number {
        return type === WalletType.indirect
            ? amount
            : Math.round((amount / gkwthPrice) * 100) / 100; // round to 2 decimal places
    }

    private static async processExcessPayment(tx: any, userId: bigint, loan: any, gkwthAmount: number, loanAmountLeft: number, type: typeof WalletType[keyof typeof WalletType]): Promise<void> {
        const excessAmount = gkwthAmount - loanAmountLeft;
        const gkwthPrice = loan.gkwthPrice || 1;
        const walletCredit = Math.round((excessAmount * gkwthPrice) * 100) / 100;

        // Repay remaining loan
        await tx.loan.update({
            where: { id: loan.id },
            data: { quantityRepaid: { increment: loanAmountLeft } }
        });

        // Credit excess to wallet
        await this.directWalletCredit(tx, userId, walletCredit, type);

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
