import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { paginate } from "../utils/pagination";
import { InitiateTransferInput } from "../validations/withdrawal.validation";
import { WithdrawalService } from "../services/withdrawal.service";

export const getTransactions = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { page, limit, orderBy } = req.query;

    const transactions = await paginate(
        prisma.withDrawal,
        {
            where: {
                userId: user.id
            },
            orderBy: {
                createdAt: (orderBy as string) === 'asc' ? 'asc' : 'desc'
            }
        },
        { 
            page: typeof page === 'string' ? page : undefined, 
            limit: typeof limit === 'string' ? limit : undefined 
        }
    );

    sendSuccess(res, 200, 'Transactions fetched successfully', transactions);
});

export const initiateTransfer = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { type } = req.query;

    // 1. Validation (Handled by middleware)
    const input = req.body as InitiateTransferInput;

    // 2. Call Service
    await WithdrawalService.initiateTransfer(user, input, typeof type === 'string' ? type : undefined);

    sendSuccess(res, 200, 'Withdrawal created successfully and under review');
});

export const approveWithdrawal = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const result = await WithdrawalService.approveWithdrawal(BigInt(req.params.id as string), req.user);
    return sendSuccess(res, 200, 'Withdrawal approved and processed', result);
});

export const getWithdrawalRequests = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { page, limit, status } = req.query;

    const requests = await paginate(
        prisma.withdrawalRequest,
        {
            where: status ? { status: status as any } : {},
            orderBy: { createdAt: 'desc' },
            include: { wallet: { include: { user: true } } }
        },
        { 
            page: typeof page === 'string' ? page : undefined, 
            limit: typeof limit === 'string' ? limit : undefined 
        }
    );

    sendSuccess(res, 200, 'Withdrawal requests fetched successfully', requests);
});