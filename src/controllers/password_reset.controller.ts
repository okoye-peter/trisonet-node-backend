import { asyncHandler } from "../middlewares/asyncHandler";
import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { addSmsJob } from "../queue/sms.queue";
import { addOtpEmailJob } from "../queue/mail.queue";
import { TermiiService } from "../services/termii.service";
import { PHP_HOSTED_ROLES } from "../config/constants";
import { redis } from "../utils/cache";
import { logger } from "../utils/logger";
import { toPhpWallClock } from "../utils/phpClock";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * Forgot password: request a 6-digit code by email or username, then set a new password with it.
 *
 * - Delivery: SMS only to Nigerian numbers (Termii can't reach others), plus email whenever the
 *   account has one. Non-Nigerians get email only. Infants use their guardian's contacts.
 * - Only the code's SHA-256 hash is stored. A code allows MAX_ATTEMPTS wrong guesses, then it is
 *   cancelled and a new one must be requested; the reset route is also IP rate limited.
 * - The send step answers the same way whether or not the account exists.
 * - password_reset_otp_sent_at is shared with the PHP app, so it's written/compared in PHP's
 *   wall-clock time (see utils/phpClock).
 */

const OTP_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const SENT_MESSAGE = "If an account matches what you entered, we've sent a reset code to its phone and/or email.";

const attemptsKey = (userId: bigint) => `password-reset:attempts:${userId}`;
const hashOtp = (otp: string) => crypto.createHash("sha256").update(otp).digest("hex");

const userSelect = {
    id: true,
    phone: true,
    email: true,
    passwordResetOtp: true,
    passwordResetOtpSentAt: true,
    guardianUser: { select: { phone: true, email: true } },
} as const;

/**
 * Finds the account an email or username refers to, among accounts that log in to this app.
 * Usernames aren't unique any more, so an ambiguous username asks for the email instead.
 */
async function findAccount(rawIdentifier: string) {
    const identifier = rawIdentifier.trim().toLowerCase();
    const isEmail = identifier.includes("@");

    const users = await prisma.user.findMany({
        where: {
            deletedAt: null,
            role: { notIn: PHP_HOSTED_ROLES },
            ...(isEmail ? { email: identifier } : { username: identifier }),
        },
        select: userSelect,
        take: 2,
    });

    if (users.length > 1) {
        throw new AppError(
            isEmail
                ? "More than one account uses this email. Please contact support to reset your password."
                : "More than one account uses this username. Please enter your email address instead.",
            400,
        );
    }
    return users[0] ?? null;
}

export const sendCustomerPasswordResetOtp = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = await findAccount(req.body.identifier ?? req.body.username);
    if (!user) {
        return sendSuccess(res, 200, SENT_MESSAGE);
    }

    const phone = user.phone ?? user.guardianUser?.phone ?? "";
    const email = user.email ?? user.guardianUser?.email ?? "";
    const sendSms = !!phone && TermiiService.getCountry(phone).country === "Nigeria";
    const sendEmail = !!email;

    if (!sendSms && !sendEmail) {
        return next(new AppError("This account has no Nigerian phone number or email address to send a reset code to. Please contact support.", 400));
    }

    const otp = crypto.randomInt(100000, 1000000).toString();

    await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetOtp: hashOtp(otp), passwordResetOtpSentAt: toPhpWallClock() },
    });
    await redis.del(attemptsKey(user.id));

    if (process.env.NODE_ENV === "production") {
        if (sendSms) await addSmsJob(phone, `Your TrisoNet password reset code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it.`);
        if (sendEmail) await addOtpEmailJob(email, otp);
    } else {
        logger.info(`[password-reset] dev OTP for user ${user.id}: ${otp} (sms: ${sendSms}, email: ${sendEmail})`);
    }

    sendSuccess(res, 200, SENT_MESSAGE);
});

export const resetCustomerPassword = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { otp, password } = req.body;
    const invalid = () => next(new AppError("Invalid or expired code. Please request a new one.", 400));

    const user = await findAccount(req.body.identifier ?? req.body.username);
    if (!user || !user.passwordResetOtp || !user.passwordResetOtpSentAt) {
        return invalid();
    }

    const clearOtp = () => prisma.user.update({
        where: { id: user.id },
        data: { passwordResetOtp: null, passwordResetOtpSentAt: null },
    });

    const ageMs = toPhpWallClock().getTime() - user.passwordResetOtpSentAt.getTime();
    if (ageMs > OTP_TTL_MINUTES * 60 * 1000) {
        await clearOtp();
        return next(new AppError("This code has expired. Please request a new one.", 400));
    }

    const expected = Buffer.from(user.passwordResetOtp);
    const given = Buffer.from(hashOtp(String(otp)));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
        const attempts = await redis.incr(attemptsKey(user.id));
        await redis.expire(attemptsKey(user.id), OTP_TTL_MINUTES * 60);
        if (attempts >= MAX_ATTEMPTS) {
            await clearOtp();
            await redis.del(attemptsKey(user.id));
            return next(new AppError("Too many wrong codes. Please request a new one.", 400));
        }
        return next(new AppError(`Invalid code. ${MAX_ATTEMPTS - attempts} attempt(s) left.`, 400));
    }

    await prisma.user.update({
        where: { id: user.id },
        data: {
            password: await bcrypt.hash(password, 10),
            passwordResetOtp: null,
            passwordResetOtpSentAt: null,
            // signs out other sessions: their refresh token stops working
            refreshToken: null,
        },
    });
    await redis.del(attemptsKey(user.id));

    sendSuccess(res, 200, "Password reset successfully");
});
