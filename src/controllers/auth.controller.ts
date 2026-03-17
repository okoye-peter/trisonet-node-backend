import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/responseWrapper';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { createUser } from '../services/customer_registration.service';

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userData = req.body;

    const existingUser = await prisma.user.findFirst({ where: { email: userData.email } });
    if (existingUser) {
        return next(new AppError('Email already in use', 400));
    }

    await createUser(userData)

    sendSuccess(res, 201, 'User registered successfully');
});

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;
    const user = await prisma.user.findFirst({
        where: { email },
        omit: {
            withdrawalPinResetOtp: true,
            withdrawalPinResetOtpSentAt: true,
            emailVerificationCode: true,
            emailVerificationCodeSentAt: true,
            passwordResetOtp: true,
            passwordResetOtpSentAt: true,
            referralActivateAt: true,
            activatedAt: true,
            lastSeen: true,
            canWithdraw: true,
            canUseVtu: true,
            canEarn: true,
            canOptOut: true,
            canWithdrawGkwth: true,
            sponsorshipAcceptedAt: true,
            sponsorAgreement: true,
            sponsorLoginOtp: true,
            sponsorLoginOtpCreatedAt: true,
            sponsorWithdrawalOtp: true,
            sponsorWithdrawalOtpSentAt: true,
            isDeactivated: true,
            sponsorSlot: true,
            loginYearlyCount: true,
            schoolFeesPermittedAt: true,
            withdrawalBypassAt: true,
            isUnitLeader: true,
            patronGroupId: true,
            activationCardId: true,
            blockedAt: true,
        },
        include: {
            region: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return next(new AppError('Incorrect email or password', 401));
    }

    const accessToken = signAccessToken(user.id.toString());
    const refreshToken = signRefreshToken(user.id.toString());

    await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
    });

    const { password: _, ...userWithoutPassword } = user;

    sendSuccess(res, 200, 'User logged in successfully', {
        user: userWithoutPassword,
        accessToken,
        refreshToken,
    });
});

export const getNewToken = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { refreshToken } = req.body;
    try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'refresh_secret') as { id: string };
        const user = await prisma.user.findUnique({ where: { id: BigInt(decoded.id) } });

        if (!user || user.refreshToken !== refreshToken) {
            return next(new AppError('Invalid refresh token', 401));
        }

        const newAccessToken = signAccessToken(user.id.toString());
        const newRefreshToken = signRefreshToken(user.id.toString());

        await prisma.user.update({
            where: { id: user.id },
            data: { refreshToken: newRefreshToken },
        });

        sendSuccess(res, 200, 'Token refreshed successfully', {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        });
    } catch (error) {
        return next(new AppError('Invalid refresh token', 401));
    }
});
