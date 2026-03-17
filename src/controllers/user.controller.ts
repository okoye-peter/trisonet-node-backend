import { asyncHandler } from "../middlewares/asyncHandler"
import { prisma } from "../config/prisma"
import { sendSuccess } from '../utils/responseWrapper'
import { NextFunction, Request, Response } from "express"
import { paginate } from "../utils/pagination"
import { MAX_ASSET_DEPOT } from "../config/constants"
import bcrypt from "bcryptjs"
import { AppError } from "../utils/AppError"
import { differenceInMinutes } from "date-fns"

export const getUserReferrals = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { page, limit, search } = req.query;

    const whereClause: any = {
        referralId: req.user.id
    };

    if (search) {
        whereClause.OR = [
            { name: { contains: String(search) } },
            { email: { contains: String(search) } },
            { username: { contains: String(search) } }
        ];
    }

    const paginatedReferrals = await paginate(
        prisma.user,
        {
            where: whereClause,
            orderBy: { createdAt: 'desc' }
        },
        {
            page: Number(page),
            limit: Number(limit)
        }
    );

    sendSuccess(res, 200, 'User referrals fetched successfully', paginatedReferrals);
})


export const getAuthUser = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const {
        password, emailVerificationCode, referralId, passwordResetOtp,
        passwordResetOtpSentAt, rememberToken, createdAt, updatedAt,
        withdrawalPin, withdrawalPinResetOtp, withdrawalPinResetOtpSentAt,
        referralActivateAt, infantGroupId, canWithdraw, canUseVtu,
        deletedAt, canEarn, canOptOut, canWithdrawGkwth,
        sponsorshipAcceptedAt, sponsorAgreement, sponsorshipStatus,
        sponsorLoginOtp, sponsorLoginOtpCreatedAt, influencerId,
        sponsorWithdrawalOtp, sponsorWithdrawalOtpSentAt, isDeactivated,
        sponsorId, sponsorSlot, loginYearlyCount, schoolFeesPermittedAt,
        withdrawalBypassAt, schoolId, address, sponsorClass,
        blockedAt, influencerPromoPeriodId,
        guardianId, guardianWardSlotId, patronGroupId,
        activationCardId, refreshToken,
        ...user
    } = req.user;
    sendSuccess(res, 200, 'User fetched successfully', user);
})

export const getUserDashboardStats = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;

    const [totalSales, wallets, region, regionTotalUsers] = await Promise.all([
        prisma.user.count({
            where: {
                referralId: user.id,
                status: true
            }
        }),
        prisma.wallet.findMany({
            where: {
                userId: user.id
            }
        }),
        prisma.region.findFirst({
            where: {
                id: user.regionId
            }
        }),
        prisma.user.count({
            where: {
                regionId: user.regionId
            }
        })
    ])

    const assetDepot = MAX_ASSET_DEPOT - (totalSales % MAX_ASSET_DEPOT);

    sendSuccess(res, 200, 'User dashboard stats fetched successfully', {
        totalSales,
        wallets,
        region,
        regionTotalUsers,
        assetDepot
    });
})

export const sendProfileUpdateOtp = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    await prisma.user.update({
        where: { id: user.id },
        data: { 
            passwordResetOtp: otp, 
            passwordResetOtpSentAt: new Date() 
        }
    });

    // In a real app, send via TermiiService here. For now, we'll just return it in dev or log it.
    console.log(`Profile Update OTP for ${user.email}: ${otp}`);

    sendSuccess(res, 200, 'Verification code sent to your email');
});

export const updateProfile = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { name, phone, bank, accountNumber, otp, currentPassword } = req.body;

    // If changing sensitive info (bank details), verify password and OTP
    if (bank || accountNumber) {
        if (!currentPassword || !otp) {
            return next(new AppError('Password and verification code are required to update bank details', 400));
        }

        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return next(new AppError('Invalid current password', 400));
        }

        if (user.passwordResetOtp !== otp) {
            return next(new AppError('Invalid verification code', 400));
        }

        const minutesPassed = differenceInMinutes(new Date(), user.passwordResetOtpSentAt!);
        if (minutesPassed > 15) {
            return next(new AppError('Verification code has expired', 400));
        }
    }

    const updatedUser = await prisma.user.update({
        where: {
            id: user.id
        },
        data: {
            name: name || undefined,
            phone: phone || undefined,
            bank: bank || undefined,
            accountNumber: accountNumber || undefined,
            passwordResetOtp: (bank || accountNumber) ? null : undefined,
            passwordResetOtpSentAt: (bank || accountNumber) ? null : undefined
        } as any
    });
    sendSuccess(res, 200, 'User profile updated successfully', updatedUser);
})

export const updatePassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const { currentPassword, password } = req.body;
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
        sendSuccess(res, 400, 'Invalid current password');
    }
    const updatedUser = await prisma.user.update({
        where: {
            id: user.id
        },
        data: {
            password: await bcrypt.hash(password, 12)
        }
    });
    sendSuccess(res, 200, 'User password updated successfully');
})