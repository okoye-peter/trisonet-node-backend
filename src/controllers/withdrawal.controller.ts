import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { paginate } from "../utils/pagination";
import { initiateTransferSchema, InitiateTransferInput } from "../validations/withdrawal.validation";
import { ROLES, WITHDRAWAL_STATUSES } from "../config/constants";
import { AppError } from "../utils/AppError";
import bcrypt from "bcryptjs";
import { WithdrawalService } from "../services/withdrawal.service";

export const getTransactions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
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
        { page: page as string, limit: limit as string }
    );

    sendSuccess(res, 200, 'Transactions fetched successfully', transactions);
});

export const initiateTransfer = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const { type } = req.query;

    // 1. Validation (Handled by middleware)
    const input = req.body as InitiateTransferInput;

    // 2. Call Service
    await WithdrawalService.initiateTransfer(user, input, type as string);

    sendSuccess(res, 200, 'Withdrawal created successfully and under review');
});