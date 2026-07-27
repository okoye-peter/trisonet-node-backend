import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { ROLES } from '../config/constants';
import { asyncHandler } from './asyncHandler';

/**
 * Restricts access to the auction feature to customers who are:
 * - level >= 2
 * - adults (not isInfant)
 * - activated (status === true)
 * - not blocked (blockedAt is null)
 *
 * Unlike role-restriction middleware, there is no bypass for other roles
 * (Patron/Admin/etc.) — the auction feature is customer-only.
 */
export const requireAuctionEligibility = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
        return next(new AppError('You are not logged in! Please log in to get access.', 401));
    }

    if (Number(user.role) !== ROLES.CUSTOMER) {
        return next(new AppError('The auction feature is only available to customers.', 403));
    }

    if (user.isInfant) {
        return next(new AppError('The auction feature is only available to adult accounts.', 403));
    }

    if (user.level < 2) {
        return next(new AppError('The auction feature requires account level 2 or higher.', 403));
    }

    if (!user.status) {
        return next(new AppError("Your account isn't activated, activate your account first.", 403));
    }

    if (user.blockedAt) {
        return next(new AppError('Your account has been disabled. Please reactivate to continue.', 403));
    }

    next();
});
