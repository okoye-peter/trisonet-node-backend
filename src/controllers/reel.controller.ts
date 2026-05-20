import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { prisma } from "../config/prisma";

/**
 * Fetch all reels ordered by newest first with pagination
 */
export const getReels = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [reels, total] = await Promise.all([
        prisma.reel.findMany({
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
        }),
        prisma.reel.count(),
    ]);

    // Format BigInt fields as string to prevent JSON serialization errors
    const formattedReels = reels.map((reel) => ({
        ...reel,
        id: reel.id.toString(),
    }));

    return sendSuccess(res, 200, "Reels fetched successfully", {
        data: formattedReels,
        current_page: page,
        last_page: Math.ceil(total / limit),
        total,
        per_page: limit,
    });
});
