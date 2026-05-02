import { asyncHandler } from "../middlewares/asyncHandler";
import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import EarningService from "../services/earning.service";
import { prisma } from "../config/prisma";
import { WalletType } from "@prisma/client";
import { ROLES } from "../config/constants";
import { AppError } from "../utils/AppError";

/**
 * Get paginated earning transactions for the auth user.
 */
export const getAuthUserEarningTransactions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { page, limit, search, type } = req.query;

    const result = await EarningService.getEarningTransactions(userId, {
        page: page as string,
        limit: limit as string,
        search: search as string,
        type: type as string
    });

    sendSuccess(res, 200, 'Earning transactions fetched successfully', result);
});

/**
 * Get conversion info for customers (Level 2+)
 */
export const getConversionInfo = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (user.role !== ROLES.CUSTOMER || user.level < 2) {
        throw new AppError('Only Level 2 customers can access this feature', 403);
    }

    // Get all user wallet IDs first to avoid TS issues in the Promise.all
    const userWallets = await prisma.wallet.findMany({
        where: { userId: user.id },
        select: { id: true }
    });
    const userWalletIds = userWallets.map(w => w.id);

    // Fetch earning wallet, indirect wallet (GKWTH), and last conversion
    const [earningWallet, indirectWallet, conversionRateSetting, lastConversion] = await Promise.all([
        prisma.wallet.findFirst({
            where: { userId: user.id, type: WalletType.earning }
        }),
        prisma.wallet.findFirst({
            where: { userId: user.id, type: WalletType.indirect }
        }),
        prisma.setting.findUnique({
            where: { key: 'asset_gkwth_conversion_rate' }
        }),
        prisma.earningTransaction.findFirst({
            where: { 
                walletId: { in: userWalletIds },
                type: 'debit',
                narration: { contains: 'Conversion' }
            },
            orderBy: { createdAt: 'desc' }
        })
    ]);

    const conversionRate = Number(conversionRateSetting?.value) || 1;
    const assetBalance = Number(earningWallet?.amount) || 0;
    const gkwthBalance = Number(indirectWallet?.amount) || 0;
    
    // Calculate 50% limit and 7-day interval
    const maxConvertibleAmount = assetBalance * 0.5;
    let nextAllowedConversionDate = null;
    if (lastConversion) {
        const lastDate = new Date(lastConversion.createdAt!);
        nextAllowedConversionDate = new Date(lastDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    return sendSuccess(res, 200, 'Conversion info retrieved successfully', {
        assetBalance,
        gkwthBalance,
        conversionRate,
        maxConvertibleAmount,
        nextAllowedConversionDate
    });
});

/**
 * Convert assets to GKWTH for customers (Level 2+)
 */
export const convertEarnings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { amount } = req.body;

    if (user.role !== ROLES.CUSTOMER || user.level < 2) {
        throw new AppError('Only Level 2 customers can access this feature', 403);
    }

    if (!amount || amount <= 0) {
        throw new AppError('Invalid amount to convert', 400);
    }

    // Check 7-day interval
    const userWalletIds = await prisma.wallet.findMany({ where: { userId: user.id }, select: { id: true } }).then(ws => ws.map(w => w.id));
    const lastConversion = await prisma.earningTransaction.findFirst({
        where: { 
            walletId: { in: userWalletIds },
            type: 'debit',
            narration: { contains: 'Conversion' }
        },
        orderBy: { createdAt: 'desc' }
    });

    if (lastConversion) {
        const lastDate = new Date(lastConversion.createdAt!);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (lastDate > sevenDaysAgo) {
            const nextDate = new Date(lastDate.getTime() + 7 * 24 * 60 * 60 * 1000);
            throw new AppError(`You can only convert once every 7 days. Next conversion available after ${nextDate.toLocaleString()}`, 400);
        }
    }

    // Fetch conversion rate
    const conversionRateSetting = await prisma.setting.findUnique({
        where: { key: 'asset_gkwth_conversion_rate' }
    });
    const conversionRate = Number(conversionRateSetting?.value) || 1;
    const convertedAmount = Number(amount) / conversionRate;

    await prisma.$transaction(async (tx) => {
        const earningWallet = await tx.wallet.findFirst({
            where: { userId: user.id, type: WalletType.earning }
        });

        const indirectWallet = await tx.wallet.findFirst({
            where: { userId: user.id, type: WalletType.indirect }
        });

        if (!earningWallet || Number(earningWallet.amount) < Number(amount)) {
            throw new AppError('Insufficient asset balance', 400);
        }

        if (!indirectWallet) {
            throw new AppError('GKWTH wallet not found', 404);
        }

        // Enforce 50% limit
        const limit = Number(earningWallet.amount) * 0.5;
        if (Number(amount) > limit) {
            throw new AppError(`You can only convert up to 50% of your asset balance (${limit.toFixed(2)})`, 400);
        }

        // Debit earning wallet
        await tx.wallet.update({
            where: { id: earningWallet.id },
            data: { amount: { decrement: Number(amount) } }
        });

        // Credit indirect wallet
        await tx.wallet.update({
            where: { id: indirectWallet.id },
            data: { amount: { increment: convertedAmount } }
        });

        // Create earning transaction (debit)
        await tx.earningTransaction.create({
            data: {
                walletId: earningWallet.id,
                amount: Number(amount),
                type: 'debit',
                narration: `Conversion of ${amount} assets to ${convertedAmount.toFixed(2)} GKWTH`,
                reference: `CONV-${Date.now()}`
            }
        });
    });

    return sendSuccess(res, 200, 'Assets converted to GKWTH successfully', {
        convertedAmount,
        conversionRate
    });
});
