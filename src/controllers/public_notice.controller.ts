import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { sendSuccess } from '../utils/responseWrapper';
import prisma from '../config/prisma';

export const getActiveNotice = asyncHandler(async (req: Request, res: Response) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const notice = await prisma.publicNotice.findFirst({
        where: { createdAt: { gte: cutoff } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, text: true, createdAt: true },
    });

    sendSuccess(res, 200, 'Public notice fetched', notice
        ? { ...notice, id: notice.id.toString() }
        : null
    );
});
