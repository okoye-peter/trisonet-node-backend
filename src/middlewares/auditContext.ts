import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

export interface AuditContext {
    userId?: bigint | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
    endpoint?: string | undefined;
}

export const auditStorage = new AsyncLocalStorage<AuditContext>();

/**
 * Middleware to initialize the audit context for each request.
 */
export const auditContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const context: AuditContext = {
        ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
        endpoint: `${req.method} ${req.originalUrl}`,
    };

    auditStorage.run(context, () => {
        next();
    });
};

/**
 * Helper to update the userId in the current audit context.
 * Called after the user is authenticated.
 */
export const setAuditUser = (userId: bigint) => {
    const store = auditStorage.getStore();
    if (store) {
        store.userId = userId;
    }
};
