import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { paginate } from "../utils/pagination";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";
import WalletService from "../services/wallet.service";
import { getSafeUserWallets } from "../utils/prismaUtils";

export const getWalletTransfers = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const { page, limit, search } = req.query;

    const transfers = await paginate(
        prisma.walletTransfer,
        {
            where: {
                OR: [
                    { senderWallet: { userId: user.id } },
                    { receiverWallet: { userId: user.id } },
                ],
                ...(search && { reference: { contains: search as string } }),
            },
            include: {
                senderWallet: {
                    include: {
                        user: {
                            select: { id: true, name: true, transferId: true, pictureUrl: true }
                        }
                    }
                },
                receiverWallet: {
                    include: {
                        user: {
                            select: { id: true, name: true, transferId: true, pictureUrl: true }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        },
        { page: page as string, limit: limit as string },
    );

    sendSuccess(res, 200, 'wallet transfers fetched successfully', transfers);
});

export const getAuthUserWallets = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    let wallets = await getSafeUserWallets(user.id);

    // If member patron, also fetch parent's patronage wallet
    if (user.patronId) {
        const parentPatronageWallet = await prisma.wallet.findFirst({
            where: {
                userId: user.patronId,
                type: 'patronage'
            }
        });

        if (parentPatronageWallet) {
            // Mark it as parent's so frontend knows
            (parentPatronageWallet as any).isParentWallet = true;
            wallets.push(parentPatronageWallet);
        }
    }

    sendSuccess(res, 200, 'wallets fetched successfully', wallets);
});


export const transferFunds = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { receiverTransferId, senderWalletId, amount, pin } = req.body;
    const senderId = req.user.id;

    if (!receiverTransferId || !senderWalletId || !amount || !pin) {
        return next(new AppError('Missing required fields', 400));
    }

    try {
        const transferService = await WalletService.transferFunds(
            senderId,
            receiverTransferId as string,
            BigInt(senderWalletId),
            Number(amount),
            pin as string
        );

        sendSuccess(res, 201, 'Transfer successful', {
            ...transferService,
            id: transferService.id.toString(),
            senderWalletId: transferService.senderWalletId.toString(),
            receiverWalletId: transferService.receiverWalletId.toString(),
            amount: Number(transferService.amount) 
        });
    } catch (error: any) {
        return next(new AppError(error.message, 400));
    }
});

export const getGkwthPrices = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const keys = ['up_front_sale_price', 'gkwth_sale_price', 'gkwth_purchase_price', 'commission_price'];

    const settings = await prisma.setting.findMany({
        where: { key: { in: keys } }
    });

    const settingsMap = settings.reduce((acc: Record<string, string>, setting: any) => {
        acc[setting.key] = setting.value;
        return acc;
    }, {} as Record<string, string>);

    sendSuccess(res, 200, 'Gkwth prices fetched successfully', {
        loanPurchasePrice: settingsMap['up_front_sale_price'] || null,
        gkwthSalePrice: settingsMap['gkwth_sale_price'] || null,
        gkwthPurchasePrice: settingsMap['gkwth_purchase_price'] || null,
        commissionPrice: settingsMap['commission_price'] || null,
    });
});

export const getWalletHistory = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const { page, limit } = req.query;

    const wallets = await prisma.wallet.findMany({
        where: { userId: user.id, type: 'direct' },
        select: { id: true },
    });

    const walletIds = wallets.map((w) => w.id.toString());

    if (walletIds.length === 0) {
        return sendSuccess(res, 200, 'Wallet history fetched successfully', {
            data: [],
            meta: { totalItems: 0, itemsPerPage: 10, currentPage: 1, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
        });
    }

    const history = await paginate(
        prisma.auditLog as any,
        {
            where: {
                model: 'Wallet',
                modelId: { in: walletIds },
                action: 'UPDATE',
            },
            orderBy: { createdAt: 'desc' },
        },
        { page: page as string, limit: limit as string },
    );

    const serialized = {
        ...history,
        data: history.data.map((log: any) => ({
            id: log.id.toString(),
            action: log.action,
            oldValues: log.oldValues,
            newValues: log.newValues,
            endpoint: log.endpoint,
            createdAt: log.createdAt,
        })),
    };

    sendSuccess(res, 200, 'Wallet history fetched successfully', serialized);
});