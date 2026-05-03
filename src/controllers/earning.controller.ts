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
 * Get conversion info for all users
 */
export const getConversionInfo = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    // Get all user wallet IDs first
    const userWallets = await prisma.wallet.findMany({
        where: { userId: user.id },
        select: { id: true }
    });
    const userWalletIds = userWallets.map(w => w.id);

    // Fetch earning wallet, indirect wallet (GKWTH)
    const [earningWallet, indirectWallet, conversionRateSetting] = await Promise.all([
        prisma.wallet.findFirst({
            where: { userId: user.id, type: WalletType.earning }
        }),
        prisma.wallet.findFirst({
            where: { userId: user.id, type: WalletType.indirect }
        }),
        prisma.setting.findUnique({
            where: { key: 'asset_gkwth_conversion_rate' }
        })
    ]);

    const conversionRate = Number(conversionRateSetting?.value) || 1;
    const assetBalance = Number(earningWallet?.amount) || 0;
    const gkwthBalance = Number(indirectWallet?.amount) || 0;

    // Fetch last conversion for the 7-day check
    const lastConversion = earningWallet ? await prisma.earningTransaction.findFirst({
        where: { 
            walletId: earningWallet.id,
            reference: { startsWith: 'CONV-' }
        },
        orderBy: { createdAt: 'desc' }
    }) : null;

    // Calculate limits
    const maxConvertibleAmount = assetBalance * 0.5;
    let nextAllowedConversionDate = null;
    if (lastConversion && lastConversion.createdAt) {
        const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
        nextAllowedConversionDate = new Date(new Date(lastConversion.createdAt).getTime() + sevenDaysInMs);
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
 * Convert assets to GKWTH for all users
 */
export const convertEarnings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
        throw new AppError('Invalid amount to convert', 400);
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

        if (earningWallet && Number(amount) > (0.5 * Number(earningWallet.amount))) {
            throw new AppError('You can only convert 50% of your asset balance at once', 400);
        }

        const lastTranx = await tx.earningTransaction.findFirst({
            where: {
                walletId: earningWallet.id, reference: {
                    startsWith: 'CONV-'
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        console.log('Last conversion transaction:', lastTranx);
        if (lastTranx && lastTranx.createdAt) {
            const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
            const nextAllowedDate = new Date(new Date(lastTranx.createdAt).getTime() + sevenDaysInMs);

            if (new Date() < nextAllowedDate) {
                throw new AppError(`You can only convert once every 7 days. Next conversion available after ${nextAllowedDate.toLocaleString()}`, 400);
            }
        }

        if (!indirectWallet) {
            throw new AppError('GKWTH wallet not found', 404);
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
                reference: `CONV-${Date.now()}`,
                createdAt: new Date()
            }
        });
    });

    return sendSuccess(res, 200, 'Assets converted to GKWTH successfully', {
        convertedAmount,
        conversionRate
    });
});
