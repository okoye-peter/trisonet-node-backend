import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import { signAccessToken, signRefreshToken } from "../utils/jwt";
import { prisma } from "../config/prisma";
import { getSafeUserWallets } from "../utils/prismaUtils";
import { StoreGuestService } from "../services/store_guest.service";

export const registerStoreGuest = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { name, email, phone, password, inviteCode } = req.body;

        const user = await StoreGuestService.registerGuest({ name, email, phone, password, inviteCode });

        const accessToken = signAccessToken(user.id.toString());
        const refreshToken = signRefreshToken(user.id.toString());

        await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

        const wallets = await getSafeUserWallets(user.id);
        const { password: _pw, ...userWithoutPassword } = user as any;

        sendSuccess(res, 201, "Registered successfully", {
            user: { ...userWithoutPassword, wallets },
            accessToken,
            refreshToken,
        });
    }
);

export const getInviteCode = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const code = await StoreGuestService.getOrCreateInviteCode(user.id);
        sendSuccess(res, 200, "Invite code retrieved successfully", { code });
    }
);

export const getCommissionSummary = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const logs = await prisma.commissionLog.findMany({
            where: { recipientId: user.id, type: 'store_invite' },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        const total = logs
            .filter((l) => l.status === 'success')
            .reduce((sum, l) => sum + Number(l.amount ?? 0), 0);

        sendSuccess(res, 200, "Commission summary retrieved successfully", { total, logs });
    }
);

export const requestUpgrade = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const request = await StoreGuestService.requestUpgrade(user.id);
        sendSuccess(res, 201, "Upgrade request created successfully", request);
    }
);

export const getUpgradeRequest = asyncHandler(
    async (req: Request, res: Response) => {
        const user = (req as any).user;
        const request = await StoreGuestService.getUpgradeRequest(user.id);
        sendSuccess(res, 200, "Upgrade request retrieved successfully", request);
    }
);
