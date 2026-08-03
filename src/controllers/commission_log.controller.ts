import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import { paginate } from "../utils/pagination";

const recipientSelect = {
    select: { id: true, name: true, username: true, phone: true, email: true }
};

/**
 * Admin/support lookup of commission audit trail entries.
 * Supports filtering by recipient, the user whose activation triggered the
 * commission decision, status (success/failed/skipped), commission type,
 * and the activation/payment reference - so a specific complaint
 * ("why didn't I get commission for X's activation?") can be traced exactly.
 */
export const getCommissionLogs = asyncHandler(async (req: Request, res: Response) => {
    const { recipientId, sourceUserId, status, type, reference, from, to, page, limit } = req.query;

    const where: any = {};
    if (recipientId) where.recipientId = BigInt(recipientId as string);
    if (sourceUserId) where.sourceUserId = BigInt(sourceUserId as string);
    if (status) where.status = status as string;
    if (type) where.type = type as string;
    if (reference) where.reference = { contains: reference as string };
    if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from as string);
        if (to) where.createdAt.lte = new Date(to as string);
    }

    const result = await paginate(
        prisma.commissionLog,
        {
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                recipient: recipientSelect,
                sourceUser: recipientSelect,
            }
        },
        { page: page as string, limit: limit as string }
    );

    return sendSuccess(res, 200, 'Commission logs fetched successfully', result);
});

/**
 * Self-service view: lets a logged-in user see exactly which of their
 * referral/activation-triggered commissions succeeded, were skipped, or
 * failed, and why - without needing to contact support.
 */
export const getMyCommissionLogs = asyncHandler(async (req: any, res: Response) => {
    const { status, type, page, limit } = req.query;

    const where: any = { recipientId: BigInt(req.user.id) };
    if (status) where.status = status as string;
    if (type) where.type = type as string;

    const result = await paginate(
        prisma.commissionLog,
        {
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                sourceUser: recipientSelect,
            }
        },
        { page: page as string, limit: limit as string }
    );

    return sendSuccess(res, 200, 'Your commission logs fetched successfully', result);
});
