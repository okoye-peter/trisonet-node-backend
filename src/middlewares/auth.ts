import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';
import { asyncHandler } from './asyncHandler';
import { getSafeUserWallets } from '../utils/prismaUtils';
import { ROLES, STORE_GUEST_ALLOWED_PATH_PREFIXES } from '../config/constants';

import { setAuditUser } from './auditContext';

interface JwtPayload {
    id: string;
}

const extractToken = (req: Request): string | undefined => {
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        return req.headers.authorization.split(' ')[1];
    }
    return req.cookies?.jwt;
};

const resolveUserFromToken = async (token: string) => {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as JwtPayload;
    const userId = BigInt(decoded.id);

    // Set user ID for auditing context
    setAuditUser(userId);

    const [currentUser, wallets] = await Promise.all([
        (prisma as any).user.findUnique({
            where: { id: userId },
            include: {
                patronPlan: { select: { id: true, name: true, minAmount: true, maxAmount: true, earningPercentage: true } },
                region: true
            }
        }),
        getSafeUserWallets(userId)
    ]);

    if (!currentUser || currentUser.deletedAt) {
        return null;
    }

    let patronActivated = false;
    if (Number(currentUser.role) === ROLES.PATRON) {
        const activationPivot = await (prisma as any).userPatronActivationPivotTable.findFirst({
            where: { userId: currentUser.id },
            include: { patronActivationPayment: { select: { status: true, amount: true } } }
        });
        const payment = activationPivot?.patronActivationPayment;
        const minAmount = currentUser.patronPlan?.minAmount;
        patronActivated = !!minAmount &&
            payment?.status === 1 &&
            Number(payment.amount) >= Number(minAmount);
    }

    return { ...currentUser, wallets, patronActivated };
};

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);

    if (!token) {
        return next(new AppError('You are not logged in! Please log in to get access.', 401));
    }

    try {
        const user = await resolveUserFromToken(token);

        if (!user) {
            return next(new AppError('The user belonging to this token does no longer exist.', 401));
        }

        (req as any).user = user;

        if (Number(user.role) === ROLES.STORE_GUEST) {
            const requestPath = req.originalUrl.split('?')[0] || req.originalUrl;
            const allowed = STORE_GUEST_ALLOWED_PATH_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
            if (!allowed) {
                return next(new AppError('Store guest accounts can only access the shop.', 403));
            }
        }

        next();
    } catch (error) {
        return next(new AppError('Invalid token or token expired.', 401));
    }
});

/**
 * Like `protect`, but never rejects an unauthenticated or invalid-token request —
 * it just leaves `req.user` unset so the route handler can fall back to guest
 * behavior (e.g. shop checkout without an account). Use for endpoints that must
 * work for both logged-in users and anonymous visitors.
 */
export const optionalAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);

    if (!token) {
        return next();
    }

    try {
        const user = await resolveUserFromToken(token);
        if (user) {
            (req as any).user = user;
        }
    } catch (error) {
        // Invalid/expired token on an optional-auth route: proceed as a guest
        // rather than failing the request.
    }

    next();
});

/**
 * Middleware to restrict access to specific roles
 */
export const restrictTo = (...roles: number[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as any).user;
        if (!user || !roles.includes(Number(user.role))) {
            return next(new AppError('You do not have permission to perform this action', 403));
        }
        next();
    };
};
