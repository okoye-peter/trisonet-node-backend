import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { prisma } from '../config/prisma';
import { asyncHandler } from './asyncHandler';

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
        const currentUser = await prisma.user.findUnique({ where: { id: BigInt(decoded.id) } });
        if (!currentUser) {
            return next(new AppError('The user belonging to this token does no longer exist.', 401));
        }

        // Attach user to request
        (req as any).user = currentUser;
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
