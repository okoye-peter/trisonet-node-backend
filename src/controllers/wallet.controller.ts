import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { prisma, Prisma } from "../config/prisma";
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
const COMMISSION_SOURCE_LABELS: Record<string, string> = {
    store_invite: 'Store invite commission',
    state_leader: 'State leader commission',
};

/**
 * Commission wallet ledger: credits are successful commission logs paid into the commission
 * wallet (store invites from Node, state leader payouts from the PHP weekly job), debits are
 * withdrawal requests made from it. Commission wallet writes from PHP are not in Node's audit
 * log, so this reads the source records instead of audit history.
 */
export const getCommissionWalletHistory = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10));

    const wallet = await prisma.wallet.findUnique({
        where: { userId_type: { userId: user.id, type: 'commission' } },
        select: { id: true },
    });
    // -1 never matches a wallet, so users without a commission wallet still see their logs (if any)
    const walletId = wallet?.id ?? BigInt(-1);

    const ledger = Prisma.sql`
        SELECT CONCAT('c', id) AS id, 'credit' AS direction, type AS source, amount, reason, reference,
               NULL AS status, NULL AS bank_name, NULL AS account_number, created_at
        FROM commission_logs
        WHERE recipient_id = ${user.id} AND wallet_type = 'commission' AND status = 'success'
        UNION ALL
        SELECT CONCAT('w', id), 'debit', 'withdrawal', amount_requested, NULL, reference,
               status, bank_name, account_number, created_at
        FROM withdrawal_requests
        WHERE wallet_id = ${walletId}
    `;

    const [rows, countRows] = await Promise.all([
        prisma.$queryRaw<any[]>`SELECT * FROM (${ledger}) ledger ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total FROM (${ledger}) ledger`,
    ]);

    const totalItems = Number(countRows[0]?.total ?? 0);
    const totalPages = Math.ceil(totalItems / limit);

    sendSuccess(res, 200, 'Commission wallet history fetched successfully', {
        data: rows.map((row) => ({
            id: String(row.id),
            direction: row.direction as 'credit' | 'debit',
            source: row.source as string,
            description: row.direction === 'debit'
                ? `Withdrawal to ${row.bank_name}${row.account_number ? ` ••••${String(row.account_number).slice(-4)}` : ''}`
                : COMMISSION_SOURCE_LABELS[row.source] ?? String(row.source).replace(/_/g, ' '),
            details: row.direction === 'credit' && row.source === 'state_leader' ? row.reason : null,
            amount: Number(row.amount ?? 0),
            reference: row.reference ?? null,
            status: row.status ?? 'success',
            createdAt: row.created_at,
        })),
        meta: {
            totalItems,
            itemsPerPage: limit,
            currentPage: page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
        },
    });
});
