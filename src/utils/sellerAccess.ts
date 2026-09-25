import { Request, Response, NextFunction } from "express";
import { AppError } from "./AppError";

/**
 * The partner seller marketplace (My Store, seller orders, partner products in the shop) is
 * in a closed beta: only the usernames in SELLER_FEATURE_USERNAMES (comma-separated,
 * default "dev_user") can see or use any of it. Set it to "*" to open it to everyone.
 *
 * users.username is NOT unique (the constraint was dropped), so every account sharing an
 * allowed username gets access - keep the list to usernames you know are unique.
 */
const allowedUsernames = () =>
    (process.env.SELLER_FEATURE_USERNAMES ?? 'dev_user')
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);

export const canUseSellerFeatures = (user?: { username?: string | null } | null): boolean => {
    const allowed = allowedUsernames();
    if (allowed.includes('*')) return true;
    return !!user?.username && allowed.includes(user.username.toLowerCase());
};

/** For routes behind `protect`: everyone outside the beta gets a plain 404, as if the feature didn't exist. */
export const requireSellerFeatures = (req: Request, _res: Response, next: NextFunction) => {
    if (!canUseSellerFeatures((req as any).user)) {
        return next(new AppError('Not found', 404));
    }
    next();
};
