import { PrismaClient, Prisma, WalletType, User, LoanStatus, GuardianSlotType } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ['query', 'error', 'warn'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export { PrismaClient, WalletType, LoanStatus, GuardianSlotType, Prisma };
export type { User };
export default prisma;