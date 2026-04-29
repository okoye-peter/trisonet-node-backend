import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
// import { prisma } from '../config/prisma';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/responseWrapper';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { createUser } from '../services/customer_registration.service';
import { prisma } from '../config/prisma';
import { ROLES } from '../config/constants';
import { getSafeUserWallets } from '../utils/prismaUtils';
import WalletService from '../services/wallet.service';

export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userData = req.body;

    const existingUser = await prisma.user.findFirst({ where: { email: userData.email } });
    if (existingUser) {
        return next(new AppError('Email already in use', 400));
    }

    await createUser(userData)

    sendSuccess(res, 201, 'User registered successfully');
});

export const registerPatron = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, phone, password, patronType } = req.body;

    const existingUser = await prisma.user.findFirst({ where: { email } });
    if (existingUser) {
        return next(new AppError('Email already in use', 400));
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const username = email.split('@')[0] + crypto.randomInt(1000, 9999);

    const user = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
            data: {
                name,
                email,
                phone,
                password: hashedPassword,
                username,
                role: ROLES.PATRON,
            }
        });

        if (patronType === 'group') {
            const group = await tx.patronGroup.create({
                data: {
                    owner: { connect: { id: createdUser.id } },
                    type: patronType
                }
            });

            await tx.user.update({
                where: { id: createdUser.id },
                data: { 
                    patronGroupId: group.id,
                    pendingPatronType: 'group'
                }
            });
        }

        // Initialize wallets (direct and patronage)
        await WalletService.createWallets(createdUser.id, ROLES.PATRON, tx);

        return createdUser;
    });

    sendSuccess(res, 201, 'Patron registered successfully');
});

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { email, emailOrUsername, password } = req.body;
    const identifier = email || emailOrUsername;
    const user = await prisma.user.findFirst({
        where: { 
            OR: [
                { email: identifier },
                { username: identifier }
            ]
        },
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
            bvn: true
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

    const wallets = await getSafeUserWallets(user.id);
    const userWithWallets = { ...user, wallets };

    // Allow Patrons, Admins, and Super Admins to bypass the level 2 requirement
    const bypassRoles = [ROLES.PATRON, ROLES.ADMIN, ROLES.SUPER_ADMIN];
    if (user.level < 2 && !bypassRoles.includes(user.role as any)) {
        return next(new AppError('Your account requires level 2 verification to login.', 403));
    }

    const accessToken = signAccessToken(user.id.toString());
    const refreshToken = signRefreshToken(user.id.toString());

    await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
    });

    const { password: _, ...userWithoutPassword } = userWithWallets;

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

export const handleAuthHandoff = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { token } = req.body;

    if (!token) return next(new AppError('Token required', 400));

    const hashedToken = crypto
        .createHash('sha256')
        .update(token as string)
        .digest('hex');

    // Look up the token in the shared DB
    const record = await prisma.authHandoffToken.findFirst({
        where: {
            token: hashedToken,
            used: false,
            expiresAt: {
                gt: new Date(),
            },
        },
    });

    if (!record) {
        return next(new AppError('Invalid or expired token', 401));
    }

    // Mark as used immediately (one-time use)
    await prisma.authHandoffToken.update({
        where: { id: record.id },
        data: { used: true },
    });

    // Fetch user from shared DB
    const user = await prisma.user.findUnique({
        where: { id: record.userId },
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
        } });

    if (!user) {
        return next(new AppError('User not found', 404));
    }

    // Issue your normal JWT
    const accessToken = signAccessToken(user.id.toString());
    const refreshToken = signRefreshToken(user.id.toString());

    await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
    });

    const wallets = await getSafeUserWallets(user.id);
    const userWithWallets = { ...user, wallets };
    const { password: _, ...userWithoutPassword } = userWithWallets;

    return sendSuccess(res, 200, 'User logged in successfully', {
        user: userWithoutPassword,
        accessToken,
        refreshToken,
    });
})
