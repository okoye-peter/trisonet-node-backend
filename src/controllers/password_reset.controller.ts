import { asyncHandler } from "../middlewares/asyncHandler";
import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { addSmsJob } from "../queue/sms.queue";
import bcrypt from "bcryptjs";
import { differenceInMinutes } from "date-fns";

export const sendCustomerPasswordResetOtp = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { username } = req.body;
    const user = await prisma.user.findFirst({
        where: { username },
        select: {
            id: true,
            username: true,
            name: true,
            phone: true,
            isInfant: true,
            guardianUser: {
                select: {
                    phone: true
                }
            }
        }
    });
    if (!user) {
        return next(new AppError('User not found', 404));
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const phoneNumber = user.phone ?? user.guardianUser?.phone ?? '';
    if (!phoneNumber) {
        return next(new AppError(`no valid phone number to send authentication reset verification code to`, 404));
    }
    if (process.env.NODE_ENV == 'production') {
        await addSmsJob(phoneNumber, `Your password reset OTP is ${otp}`);
    }

    await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetOtp: otp, passwordResetOtpSentAt: new Date() },
    });

    sendSuccess(res, 200, 'Password reset OTP sent successfully');
});

export const resetCustomerPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { username, otp, password } = req.body;
    const user = await prisma.user.findFirst({
        where: { username },
        select: {
            id: true,
            username: true,
            name: true,
            phone: true,
            isInfant: true,
            passwordResetOtp: true,
            passwordResetOtpSentAt: true,
            guardianUser: {
                select: {
                    phone: true
                }
            }
        }
    });
    if (!user) {
        return next(new AppError('User not found', 404));
    }

    if (user.passwordResetOtp !== otp) {
        return next(new AppError('Invalid OTP', 400));
    }
    
    if (!user.passwordResetOtpSentAt) {
        return next(new AppError('OTP has not been sent', 400));
    }
    
    // Check if more than 15 minutes have passed since the OTP was sent
    const minutesPassed = differenceInMinutes(new Date(), user.passwordResetOtpSentAt);
    if (minutesPassed > 15) {
        return next(new AppError('OTP has expired', 400));
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
        where: { id: user.id },
        data: { password: password, passwordResetOtp: null, passwordResetOtpSentAt: null },
    });
    sendSuccess(res, 200, 'Password reset successfully');
});