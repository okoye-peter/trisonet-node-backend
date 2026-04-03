import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { VtuService } from "../services/vtu.service";
import { AppError } from "../utils/AppError";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendSuccess } from "../utils/responseWrapper";

import { getSafeUserWallets } from "../utils/prismaUtils";

const vtuService = new VtuService();

export const getVtuData = asyncHandler(async (req: Request, res: Response) => {
    const wallets = await getSafeUserWallets((req as any).user.id);
    const { networks, data_bundles } = await vtuService.getVtuDataBundles();
    const { packages, providers } = (await vtuService.getVtuCableOffers()) as any;
    res.json({
        networks,
        data_bundles,
        wallets,
        packages,
        providers
    });
});

export const buyAirtime = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { amount, network, airtime_phone_no, airtime_wallet, withdrawal_pin } = req.body;
    const user = (req as any).user;

    const lockVtu = await prisma.setting.findUnique({ where: { key: 'lock_vtu' } });
    if (lockVtu?.value === '1') {
        return next(new AppError('utility services currently not available try again later', 400));
    }

    if (user.isInfant) return next(new AppError('infant are not permitted to use this service', 400));
    if (!user.status) return next(new AppError('you account needs to be activated first before you can use this service', 400));
    if (user.canUseVtu === false) {
        return next(new AppError('utility services currently not available for this account, please contact admin', 400));
    }

    if (!user.withdrawalPin) {
        return next(new AppError('please set your withdrawal pin in you profile first', 400));
    }

    const isPinValid = await bcrypt.compare(withdrawal_pin, user.withdrawalPin);
    if (!isPinValid) {
        return next(new AppError('Invalid withdrawal pin', 400));
    }

    const walletId = BigInt(airtime_wallet);
    const wallet = await prisma.wallet.findFirst({ where: { id: walletId, userId: user.id } });
    
    if (!wallet) return next(new AppError('something went wrong', 400));

    const finalAmount = amount - (0.02 * amount);
    const vtuBalance = await vtuService.getWalletBalance();
    
    if (vtuBalance === 'VTU unavailable' || parseFloat(vtuBalance) < finalAmount) {
        return next(new AppError('service currently unavailable', 400));
    }

    if (finalAmount > wallet.amount) {
        return next(new AppError('insufficient funds', 400));
    }

    const reference = crypto.randomBytes(6).toString('hex');
    const resVtu = await vtuService.purchaseVtuAirtime(network, amount, airtime_phone_no, reference);

    if (!resVtu.status) {
        return next(new AppError(resVtu.error || 'Failed to purchase airtime', 400));
    }

    const oldBalance = wallet.amount;
    const newBalance = oldBalance - finalAmount;

    await prisma.$transaction([
        prisma.wallet.update({
            where: { id: walletId },
            data: { amount: newBalance }
        }),
        prisma.withDrawal.create({
            data: {
                userId: user.id,
                amount: String(finalAmount),
                bankName: `vtu buy ${network} airtime to ${airtime_phone_no} with reference_no: ${reference}`,
                accountNumber: `${wallet.type} wallet`,
                isPaid: 1,
                oldBalance: String(oldBalance),
                newBalance: String(newBalance)
            }
        })
    ]);

    sendSuccess(res, 200, 'airtime purchased successfully');
});

export const buyData = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { data_bundle, data_network, data_phone_no, data_wallet, data_amount, withdrawal_pin } = req.body;
    const user = (req as any).user;

    const lockVtu = await prisma.setting.findUnique({ where: { key: 'lock_vtu' } });
    if (lockVtu?.value === '1') {
        return next(new AppError('utility services currently not available try again later', 400));
    }

    if (user.isInfant) return next(new AppError('infant are not permitted to use this service', 400));
    if (!user.status) return next(new AppError('you account needs to be activated first before you can use this service', 400));
    if (user.canUseVtu === false) {
        return next(new AppError('utility services currently not available for this account, please contact admin', 400));
    }

    if (!user.withdrawalPin) {
        return next(new AppError('please set your withdrawal pin in you profile first', 400));
    }

    const isPinValid = await bcrypt.compare(withdrawal_pin, user.withdrawalPin);
    if (!isPinValid) {
        return next(new AppError('Invalid withdrawal pin', 400));
    }

    const walletId = BigInt(data_wallet);
    const wallet = await prisma.wallet.findFirst({ where: { id: walletId, userId: user.id } });

    if (!wallet) return next(new AppError('something went wrong', 400));

    if (data_amount > wallet.amount) {
        return next(new AppError('insufficient funds', 400));
    }

    const vtuBalance = await vtuService.getWalletBalance();
    if (vtuBalance === 'VTU unavailable' || parseFloat(vtuBalance) < data_amount) {
        return next(new AppError('service currently unavailable', 400));
    }

    const reference = crypto.randomBytes(6).toString('hex');
    const resVtu = await vtuService.purchaseVtuDataBundle(data_network, data_bundle, data_phone_no, reference);

    if (!resVtu.status) {
        return next(new AppError(resVtu.error || 'Failed to purchase data', 400));
    }

    const oldBalance = wallet.amount;
    const newBalance = oldBalance - data_amount;

    await prisma.$transaction([
        prisma.wallet.update({
            where: { id: walletId },
            data: { amount: newBalance }
        }),
        prisma.withDrawal.create({
            data: {
                userId: user.id,
                amount: String(data_amount),
                bankName: `buy vtu ${data_network} data:${data_bundle} to ${data_phone_no} at ₦${data_amount} reference:${reference}`,
                accountNumber: `${wallet.type} wallet`,
                isPaid: 1,
                oldBalance: String(oldBalance),
                newBalance: String(newBalance)
            }
        })
    ]);

    sendSuccess(res, 200, 'data purchased successfully');
});

export const subCable = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { package: pkg, cabletv, dish_number, cable_amount, cable_wallet, withdrawal_pin } = req.body;
    const user = (req as any).user;

    const lockVtu = await prisma.setting.findUnique({ where: { key: 'lock_vtu' } });
    if (lockVtu?.value === '1') {
        return next(new AppError('utility services currently not available try again later', 400));
    }

    if (user.isInfant) return next(new AppError('infant are not permitted to use this service', 400));
    if (!user.status) return next(new AppError('you account needs to be activated first before you can use this service', 400));
    if (user.canUseVtu === false) {
        return next(new AppError('utility services currently not available for this account, please contact admin', 400));
    }

    if (!user.withdrawalPin) {
        return next(new AppError('please set your withdrawal pin in you profile first', 400));
    }

    const isPinValid = await bcrypt.compare(withdrawal_pin, user.withdrawalPin);
    if (!isPinValid) {
        return next(new AppError('Invalid withdrawal pin', 400));
    }

    const walletId = BigInt(cable_wallet);
    const wallet = await prisma.wallet.findFirst({ where: { id: walletId, userId: user.id } });

    if (!wallet) return next(new AppError('something went wrong', 400));

    if (cable_amount > wallet.amount) {
        return next(new AppError('insufficient funds', 400));
    }

    const vtuBalance = await vtuService.getWalletBalance();
    if (vtuBalance === 'VTU unavailable' || parseFloat(vtuBalance) < cable_amount) {
        return next(new AppError('service currently unavailable', 400));
    }

    const reference = crypto.randomBytes(6).toString('hex');
    const resVtu = await vtuService.purchaseCableSubscription(cabletv, pkg, dish_number, cable_amount, reference);

    if (!resVtu.status) {
        return next(new AppError(resVtu.error || resVtu.message || 'Failed to purchase cable subscription', 400));
    }

    const oldBalance = wallet.amount;
    const newBalance = oldBalance - cable_amount;

    await prisma.$transaction([
        prisma.wallet.update({
            where: { id: walletId },
            data: { amount: newBalance }
        }),
        prisma.withDrawal.create({
            data: {
                userId: user.id,
                amount: String(cable_amount),
                bankName: `vtu ${cabletv} subscription with reference ${reference}`,
                accountNumber: `${wallet.type} wallet`,
                isPaid: 1,
                oldBalance: String(oldBalance),
                newBalance: String(newBalance)
            }
        })
    ]);

    sendSuccess(res, 200, 'cable package was purchased successfully');
});