import { PagaService } from './../services/paga.service';
import { asyncHandler } from "../middlewares/asyncHandler"
import { prisma } from "../config/prisma"
import { sendSuccess } from '../utils/responseWrapper'
import { NextFunction, Request, Response } from "express"
import { paginate } from "../utils/pagination"
import { GUARDIAN_MAX_WARDS, MAX_ASSET_DEPOT, ROLES } from "../config/constants"
import bcrypt from "bcryptjs"
import { AppError } from "../utils/AppError"
import { differenceInMinutes } from "date-fns"
import { getOrSetCache } from '../utils/cache';
import { TermiiService } from '../services/termii.service';

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


export const updateProfile = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { name, phone } = req.body;

    const updatedUser = await prisma.user.update({
        where: {
            id: user.id
        },
        data: {
            name: name || undefined,
            phone: phone || undefined,
        }
    });

    // Remove sensitive fields from response
    const { password, ...userResponse } = updatedUser;

    sendSuccess(res, 200, 'User profile updated successfully', userResponse);
})

export const updateBankDetails = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { bank, accountNumber, currentPassword } = req.body;

    if (!currentPassword) {
        return next(new AppError('Password is required to update bank details', 400));
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
        return next(new AppError('Invalid current password', 400));
    }

    const updatedUser = await prisma.user.update({
        where: {
            id: user.id
        },
        data: {
            bank: bank || undefined,
            accountNumber: accountNumber || undefined,
        }
    });

    sendSuccess(res, 200, 'Bank details updated successfully');
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

export const getUserWards = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { search } = req.query;
    const whereClause: any = {
        guardianId: user.id,
        isInfant: true,
        role: ROLES.CUSTOMER
    }

    if (search) {
        whereClause.OR = [
            { name: { contains: String(search) } },
            { username: { contains: String(search) } }
        ];
    }

    const wards = await paginate(
        prisma.user,
        {
            where: whereClause,
            orderBy: { createdAt: 'desc' }
        },
        {
            page: Number(req.query.page),
            limit: Number(req.query.limit)
        }
    )

    return sendSuccess(res, 200, 'User wards fetched successfully', wards);
})

export const getUserWardStats = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id: userId } = req.user;

    const [
        unlimitedWardSlot,
        unlimitedWardPriceValue,
        limitedWardPricePerSlotValue,
        availableSlot,
        slotUsed
    ] = await Promise.all([
        prisma.guardianWardSlotPurchase.findFirst({
            where: {
                type: 'unlimited',
                userId,
                status: 'success',
                unlimitedRevokedAt: null
            }
        }),
        getOrSetCache<string>(
            'setting:unlimited_parent_ward_slot',
            3600, // 1 hour
            async () => {
                const s = await prisma.setting.findFirst({
                    where: { key: 'unlimited_parent_ward_slot' },
                    select: { value: true }
                });
                return s?.value ?? '0';
            }
        ),
        getOrSetCache<string>(
            'setting:ward_slot_purchase_price',
            3600, // 1 hour
            async () => {
                const s = await prisma.setting.findFirst({
                    where: { key: 'ward_slot_purchase_price' },
                    select: { value: true }
                });
                return s?.value ?? '0';
            }
        ),
        prisma.guardianWardSlotPurchase.aggregate({
            _sum: { quantityPurchased: true },
            where: {
                userId,
                status: 'success',
                type: 'limited'
            }
        }),
        prisma.user.count({
            where: {
                guardianId: userId,
                isInfant: true,
                role: ROLES.CUSTOMER
            }
        })
    ]);

    const paga = new PagaService();

    const wardSlotRemaining: string | number = unlimitedWardSlot
        ? 'unlimited'
        : GUARDIAN_MAX_WARDS + (availableSlot._sum.quantityPurchased ?? 0) - slotUsed;

    const rawSlotPrice = Number(limitedWardPricePerSlotValue);
    const rawUnlimitedPrice = Number(unlimitedWardPriceValue);

    const pricePerSlot = rawSlotPrice + paga.calculateCharge(rawSlotPrice);
    const unlimitedSlotPrice = rawUnlimitedPrice + paga.calculateCharge(rawUnlimitedPrice);

    sendSuccess(res, 200, 'User ward stats fetched successfully', {
        wardSlotRemaining,
        pricePerSlot,
        unlimitedSlotPrice
    });
});

export const getWardsSchoolFees = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id: userId } = req.user;
    const { page, limit, username } = req.query;

    const wardWhereClause: any = {
        guardianId: userId,
        isInfant: true,
        role: ROLES.CUSTOMER
    };

    if (username) {
        wardWhereClause.username = { contains: String(username) };
    }

    const wards = await prisma.user.findMany({
        where: wardWhereClause,
        select: { id: true }
    });

    const wardIds = wards.map(w => w.id);

    const paginatedFees = await paginate(
        prisma.infantSchoolFee,
        {
            where: {
                userId: { in: wardIds },
                infantSchoolFeeGroupId: { not: null }
            },
            include: {
                schoolTermRef: {
                    select: { id: true, name: true }
                },
                schoolLevel: {
                    select: { id: true, name: true }
                },
                infantSchoolFeeGroup: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                schoolUser: {
                                    select: { id: true, name: true }
                                }
                            }
                        }
                    }
                },
                user: {
                    select: { id: true, name: true, username: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        },
        {
            page: Number(page),
            limit: Number(limit)
        }
    );

    sendSuccess(res, 200, 'User wards school fees fetched successfully', paginatedFees);
});

export const getUserByTransferId = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const transferId = req.params.transferId as string;
    if (!transferId) return next(new AppError('Invalid transfer ID', 400));
    if (req.user.transferId === transferId) return next(new AppError('You cannot transfer to yourself', 400));

    const user = await prisma.user.findFirst({
        where: {
            transferId,
            status: true,
            accountState: 1, // Assuming 1 is true/active in this schema's context
            isInfant: false
        },
        select: {
            id: true,
            name: true,
            transferId: true,
            status: true,
            accountState: true,
            username: true // Keeping username for the UI display
        }
    });

    if (!user) {
        return next(new AppError('Invalid transfer ID or user inactive', 400));
    }

    sendSuccess(res, 200, 'User found successfully', {
        ...user,
        id: user.id.toString()
    });
});

export const sendOtpForWithdrawalPinReset = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = await prisma.user.findFirst({
        where: { id: req.user.id },
        select: {
            id: true,
            phone: true,
            guardianUser: {
                select: {
                    id: true,
                    phone: true
                }
            }
        }
    });


    if (!user) return next(new AppError('User not found', 404));

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const phone = user.phone || user.guardianUser?.phone;
    if (!phone) return next(new AppError('No phone number found', 400));

    await prisma.user.update({
        where: { id: user.id },
        data: {
            withdrawalPinResetOtp: otp,
            withdrawalPinResetOtpSentAt: new Date()
        }
    });

    if (phone) {
        TermiiService.sendSms(phone, `Your withdrawal pin reset code is ${otp}`)
    }

    sendSuccess(res, 200, 'Verification code sent to your phone number');
});

export const resetWithdrawalPin = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { otp, newPin } = req.body;
    const user = await prisma.user.findFirst({
        where: { id: req.user.id }
    });

    if (!user) return next(new AppError('User not found', 404));

    if (user.withdrawalPinResetOtp !== otp) return next(new AppError('Invalid OTP', 400));

    // 10 minutes max
    if (user.withdrawalPinResetOtpSentAt && user.withdrawalPinResetOtpSentAt < new Date(Date.now() - 10 * 60 * 1000)) return next(new AppError('OTP expired', 400));

    await prisma.user.update({
        where: { id: user.id },
        data: {
            withdrawalPin: await bcrypt.hash(newPin, 12),
            withdrawalPinResetOtp: null,
            withdrawalPinResetOtpSentAt: null
        }
    });

    sendSuccess(res, 200, 'Withdrawal pin reset successfully');
});
