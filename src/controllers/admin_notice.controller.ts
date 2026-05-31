import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import prisma from "../config/prisma";

export const getAdminNotices = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const userId = req.user.id;

    const rows = await prisma.adminNoticeUser.findMany({
        where: { userId },
        include: { adminNotice: true },
        orderBy: { adminNotice: { createdAt: "desc" } },
    });

    sendSuccess(res, 200, "Admin notices fetched successfully", {
        notices: rows.map((r) => ({
            id: r.adminNoticeId.toString(),
            title: r.adminNotice.title,
            body: r.adminNotice.body,
            createdAt: r.adminNotice.createdAt,
        })),
    });
});

