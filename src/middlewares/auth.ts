import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';
import { asyncHandler } from './asyncHandler';
import { getSafeUserWallets } from '../utils/prismaUtils';
import { ROLES } from '../config/constants';

import { setAuditUser } from './auditContext';

interface JwtPayload {
    id: string;
}

export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.jwt) {
        token = req.cookies.jwt;
    }

    if (!token) {
        return next(new AppError('You are not logged in! Please log in to get access.', 401));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as JwtPayload;
        const userId = BigInt(decoded.id);
        
        // Set user ID for auditing context
        setAuditUser(userId);

        const [currentUser, wallets] = await Promise.all([
            (prisma as any).user.findUnique({
                where: { id: userId },
                include: { patronPlan: { select: { id: true, name: true, minAmount: true, maxAmount: true, earningPercentage: true } } }
            }),
            getSafeUserWallets(userId)
        ]);

        if (!currentUser) {
            return next(new AppError('The user belonging to this token does no longer exist.', 401));
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

        // Attach user with wallets to request
        (req as any).user = { ...currentUser, wallets, patronActivated };
        next();
    } catch (error) {
        return next(new AppError('Invalid token or token expired.', 401));
    }
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
