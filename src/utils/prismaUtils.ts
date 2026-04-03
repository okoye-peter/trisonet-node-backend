import { prisma } from "../config/prisma.js";

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
        const errorMessage = error.message || "";
        const isEnumError = 
            errorMessage.includes("Value '' not found in enum") || 
            errorMessage.includes("enum") ||
            errorMessage.includes("PrismaClientUnknownRequestError");

        if (isEnumError) {
            console.warn(`[PrismaUtils] Enum mapping failed for user ${userId}. Falling back to raw query. Error: ${errorMessage.split('\n')[0]}`);
            
            // Fallback to raw query to bypass Prisma's enum validation
            const rawWallets: any[] = await prisma.$queryRaw`
                SELECT * FROM wallets WHERE user_id = ${userId} ORDER BY created_at DESC
            `;
            
            // Clean up the raw results to match Prisma's output as much as possible
            return rawWallets.map(w => ({
                ...w,
                id: typeof w.id === 'bigint' ? w.id : BigInt(w.id),
                userId: typeof w.user_id === 'bigint' ? w.user_id : BigInt(w.user_id),
                amount: Number(w.amount),
                // Map DB snake_case to Prisma camelCase if necessary, though wallets table seems to use camelCase for some but snake_case for user_id
                createdAt: w.created_at || w.createdAt,
                updatedAt: w.updated_at || w.updatedAt,
                // Ensure type is a valid string or null
                type: w.type || null
            }));
        }
        throw error;
    }
}

