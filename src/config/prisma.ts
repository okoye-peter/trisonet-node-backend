import { PrismaClient, Prisma, WalletType, User, LoanStatus, GuardianSlotType } from '@prisma/client';
import { auditStorage } from '../middlewares/auditContext';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const basePrisma = globalForPrisma.prisma ?? new PrismaClient({ log: ['query', 'error', 'warn'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

/**
 * Filter sensitive fields from audit logs and handle BigInt serialization
 */
const filterSensitiveData = (data: any) => {
    if (!data) return null;
    const sensitiveFields = [
        'password', 
        'withdrawalPin', 
        'refreshToken', 
        'passwordResetOtp', 
        'withdrawalPinResetOtp',
        'withdrawalPinResetOtpSentAt',
        'emailVerificationCode'
    ];
    
    // Deep clone and filter
    const cleaned = JSON.parse(JSON.stringify(data, (key, value) => {
        if (sensitiveFields.includes(key)) return undefined;
        if (typeof value === 'bigint') return value.toString();
        return value;
    }));

    return cleaned;
};

/**
 * Prisma Extension for Auditing
 */
const extendedPrisma = basePrisma.$extends({
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                const auditedModels = ['User', 'Wallet'];
                
                // If not an audited model or operation we don't track, just run query
                if (!auditedModels.includes(model) || !['create', 'update', 'delete', 'upsert'].includes(operation)) {
                    return query(args);
                }

                const context = auditStorage.getStore();
                const userId = context?.userId;

                // Handle Update/Delete: Need old data for comparison
                if (operation === 'update' || operation === 'delete') {
                    // Fetch current state before change
                    const oldData = await (basePrisma as any)[model].findUnique({
                        where: args.where
                    });

                    const result = await query(args);

                    if (oldData) {
                        const action = operation.toUpperCase();
                        const newData = operation === 'delete' ? null : result;

                        // Non-blocking log creation
                        (basePrisma as any).auditLog.create({
                            data: {
                                model,
                                modelId: (oldData as any)?.id?.toString() || '0',
                                action,
                                userId,
                                oldValues: filterSensitiveData(oldData) ?? Prisma.JsonNull,
                                newValues: filterSensitiveData(newData) ?? Prisma.JsonNull,
                                ipAddress: context?.ip,
                                userAgent: context?.userAgent,
                                endpoint: context?.endpoint,
                            } as any
                        }).catch((err: any) => console.error(`[Audit Error] Failed to log ${action} on ${model}:`, err));
                    }

                    return result;
                }

                // Handle Create
                if (operation === 'create') {
                    const result = await query(args);
                    
                    (basePrisma as any).auditLog.create({
                        data: {
                            model,
                            modelId: (result as any)?.id?.toString() || '0',
                            action: 'CREATE',
                            userId,
                            oldValues: Prisma.JsonNull,
                            newValues: filterSensitiveData(result) ?? Prisma.JsonNull,
                            ipAddress: context?.ip,
                            userAgent: context?.userAgent,
                            endpoint: context?.endpoint,
                        } as any
                    }).catch((err: any) => console.error(`[Audit Error] Failed to log CREATE on ${model}:`, err));

                    return result;
                }

                return query(args);
            }
        }
    }
});

// Export as base type to avoid type errors in the rest of the app
export const prisma = extendedPrisma as unknown as typeof basePrisma;

export { PrismaClient, WalletType, LoanStatus, GuardianSlotType, Prisma };
export type { User };
export default prisma;