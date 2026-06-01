import { Request, Response, NextFunction } from 'express';
import { differenceInMonths } from 'date-fns';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';
import { asyncHandler } from './asyncHandler';
import { ROLES } from '../config/constants';

/**
 * Mirrors the PHP IsBlockedMiddleware.
 * Applies only to non-infant customers.
 *
 * If already blocked  → 403.
 * If not yet blocked  → check inactivity; auto-block and return 403 when the
 *                       user has been inactive ≥ 3 months with no recent referral.
 * All other roles     → pass through unchanged.
 */
export const isBlocked = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (Number(user.role) !== ROLES.CUSTOMER || user.isInfant) {
        return next();
    }

    const now = new Date();

    if (user.blockedAt) {
        return next(new AppError('Your account has been disabled. Please reactivate to continue.', 403));
    }

    // Grace period: recently upgraded to adult (< 3 months)
    if (user.upgradeToAdultAt) {
        if (differenceInMonths(now, new Date(user.upgradeToAdultAt)) < 3) {
            await touchLastSeen(user, now);
            return next();
        }
    }

    const inactiveMonths = user.lastSeen ? differenceInMonths(now, new Date(user.lastSeen)) : 0;

    // Last direct referral (user referred by this user)
    const lastReferral = await (prisma as any).user.findFirst({
        where: { referralId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { referralActivateAt: true, createdAt: true },
    });

    // PHP: now()->diffInMonths($last_referral->activated_at ?? $last_referral->created_at) >= 3
    const referralDate = lastReferral?.referralActivateAt || lastReferral?.createdAt;
    const referralMonths = referralDate ? differenceInMonths(now, new Date(referralDate)) : 0;

    // PHP condition: allow if inactive < 3 months OR has a referral >= 3 months old
    if (inactiveMonths < 3 || (lastReferral && referralMonths >= 3)) {
        await touchLastSeen(user, now);
        return next();
    }

    // Block the user
    await (prisma as any).user.update({
        where: { id: user.id },
        data: { blockedAt: now },
    });

    return next(new AppError('Your account has been disabled due to inactivity. Please reactivate to continue.', 403));
});

async function touchLastSeen(user: any, now: Date) {
    const todayStr = now.toDateString();
    const lastSeenStr = user.lastSeen ? new Date(user.lastSeen).toDateString() : null;
    if (lastSeenStr !== todayStr) {
        await (prisma as any).user.update({
            where: { id: user.id },
            data: { lastSeen: now },
        });
    }
}
