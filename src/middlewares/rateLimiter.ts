import { Request, Response, NextFunction } from 'express';
import { redis } from '../utils/cache';
import { AppError } from '../utils/AppError';

interface RateLimitOptions {
    windowMs: number;
    max: number;
    message?: string;
    keyPrefix?: string;
}

export const rateLimiter = (options: RateLimitOptions) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        // req.ip already honors Express's `trust proxy` setting (see app.set('trust proxy', ...)
        // in src/index.ts), so it correctly resolves X-Forwarded-For when behind a proxy.
        // Falling back to the raw header would just re-introduce the same spoofing risk
        // trust proxy is meant to guard against.
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const key = `${options.keyPrefix || 'rate-limit'}:${ip}`;

        try {
            // Atomic increment and expire using Lua script
            const luaScript = `
                local current = redis.call('INCR', KEYS[1])
                if current == 1 then
                    redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return current
            `;
            
            const requests = await redis.eval(luaScript, 1, key, Math.floor(options.windowMs / 1000)) as number;

            if (requests > options.max) {
                const ttl = await redis.ttl(key);
                return next(new AppError(options.message || `Too many requests, please try again in ${ttl} seconds.`, 429));
            }

            next();
        } catch (error) {
            console.error('Rate limiter error:', error);
            // Fallback: allow request if redis is down
            next();
        }
    };
};

export const userRateLimiter = (options: RateLimitOptions) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const userId = (req as any).user?.id;
        if (!userId) return next(new AppError('Unauthorized', 401));

        const key = `${options.keyPrefix || 'user-rate-limit'}:${userId}`;

        try {
            // Atomic increment and expire using Lua script
            const luaScript = `
                local current = redis.call('INCR', KEYS[1])
                if current == 1 then
                    redis.call('EXPIRE', KEYS[1], ARGV[1])
                end
                return current
            `;

            const requests = await redis.eval(luaScript, 1, key, Math.floor(options.windowMs / 1000)) as number;

            if (requests > options.max) {
                const ttl = await redis.ttl(key);
                return next(new AppError(options.message || `Too many requests, please try again in ${ttl} seconds.`, 429));
            }

            next();
        } catch (error) {
            console.error('Rate limiter error:', error);
            // Fallback: allow request if redis is down
            next();
        }
    };
};

// Common reusable limiters
export const otpLimiter = rateLimiter({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    message: "Too many OTP requests. Please try again after 10 minutes.",
    keyPrefix: "otp-limit"
});

export const withdrawalPinOtpLimiter = rateLimiter({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    message: "Too many OTP requests. Please try again after 10 minutes.",
    keyPrefix: "withdrawal-pin-otp-limit"
});

export const authLimiter = rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 5,
    message: "Too many attempts. Please try again after 15 minutes.",
    keyPrefix: "auth-limit"
});

// Shared across all KYC verification methods (BVN, face, NIN, passport) so a user
// can't dodge the limit by just switching methods after a failed/rejected attempt.
export const kycDailyLimiter = userRateLimiter({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 2,
    message: "You can only attempt KYC verification once per day. Please try again tomorrow.",
    keyPrefix: "kyc-daily-limit"
});

/**
 * Creates a rate limiter middleware.
 * @param minutes - Window in minutes.
 * @param keyPrefix - Unique prefix for the key.
 * @param message - Custom error message.
 * @param max - Maximum requests allowed in the window (default: 3).
 */
export const createRateLimiter = (minutes: number, keyPrefix: string, message: string, max: number = 3) => {
    return rateLimiter({
        windowMs: minutes * 60 * 1000,
        max,
        message,
        keyPrefix
    });
};
