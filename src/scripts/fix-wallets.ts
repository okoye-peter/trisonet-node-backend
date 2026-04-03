import { prisma, WalletType } from "../config/prisma.js";

async function fixWallets() {
    console.log("Starting wallet data repair...");

    try {
        // 1. Find all wallets that have an empty string as a type
        // Since Prisma doesn't directly support querying for invalid enum values with findMany,
        // we'll use a raw query to find them.
        const invalidWallets: any[] = await prisma.$queryRaw`
            SELECT id, user_id, type FROM wallets WHERE type = '' OR type IS NULL
        `;

        if (invalidWallets.length === 0) {
            console.log("No wallets with invalid types ('') or NULL found.");
            return;
        }

        console.log(`Found ${invalidWallets.length} wallets with invalid types.`);

        let fixedCount = 0;
        for (const wallet of invalidWallets) {
            // Defaulting to 'direct' if the type is missing or empty, 
            // as it's the most common wallet type.
            await prisma.wallet.update({
                where: { id: wallet.id },
                data: { type: WalletType.direct }
            });
            fixedCount++;
        }

        console.log(`Successfully fixed ${fixedCount} wallets.`);
    } catch (error: any) {
        console.error("Error during wallet repair:", error.message);
    } finally {
        await prisma.$disconnect();
    }
}

fixWallets();
