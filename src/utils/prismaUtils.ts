import { prisma, WalletType } from "../config/prisma.js";

/**
 * Safely fetches wallets for a user.
 * If Prisma fails due to an enum mapping error (e.g. invalid 'type' in DB),
 * it falls back to a raw query which doesn't have the enum mapping overhead.
 */
export async function getSafeUserWallets(userId: bigint) {
    try {
        return await prisma.wallet.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });
    } catch (error: any) {
        if (error.message.includes("Value '' not found in enum") || error.message.includes("enum")) {
            console.warn(`[PrismaUtils] Enum mapping failed for user ${userId}. Falling back to raw query.`);
            
            // Fallback to raw query to bypass Prisma's enum validation
            const rawWallets: any[] = await prisma.$queryRaw`
                SELECT * FROM wallets WHERE user_id = ${userId} ORDER BY created_at DESC
            `;
            
            // Clean up the raw results to match Prisma's output as much as possible
            return rawWallets.map(w => ({
                ...w,
                id: BigInt(w.id),
                userId: BigInt(w.user_id),
                // If type is invalid, we'll keep it as a string instead of crashing, 
                // but we can also default it here if we want.
                type: w.type || null
            }));
        }
        throw error;
    }
}
