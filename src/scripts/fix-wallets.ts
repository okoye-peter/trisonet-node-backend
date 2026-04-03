import { prisma, WalletType } from "../config/prisma.js";

async function deepCleanWallets() {
    console.log("Starting DEEP CLEAN wallet data repair...");

    const validTypes = ['direct', 'indirect', 'central_treasury', 'patronage', 'earning'];
    const validTypesStr = validTypes.map(t => `'${t}'`).join(', ');

    try {
        // Find all wallets that have a type NOT in the valid list
        const invalidWallets: any[] = await prisma.$queryRawUnsafe(`
            SELECT id, user_id, type FROM wallets 
            WHERE type NOT IN (${validTypesStr}) OR type IS NULL OR type = ''
        `);

        if (invalidWallets.length === 0) {
            console.log("No invalid wallet types found. Checking for exact empty strings specifically...");
            // Extra check for empty strings which sometimes behave weirdly in MySQL enums
            const emptyStrings: any[] = await prisma.$queryRaw`SELECT id FROM wallets WHERE type = ''`;
            if (emptyStrings.length === 0) {
                console.log("Clean! No corrupt wallet data found.");
                return;
            }
            invalidWallets.push(...emptyStrings);
        }

        console.log(`Found ${invalidWallets.length} wallets with invalid or corrupt types.`);

        let fixedCount = 0;
        for (const wallet of invalidWallets) {
            console.log(`Fixing wallet ID ${wallet.id} (current type: '${wallet.type}')`);
            await prisma.wallet.update({
                where: { id: BigInt(wallet.id) },
                data: { type: WalletType.direct }
            });
            fixedCount++;
        }

        console.log(`Successfully repaired ${fixedCount} wallets.`);
    } catch (error: any) {
        console.error("Error during deep clean:", error.message);
    } finally {
        await prisma.$disconnect();
    }
}

deepCleanWallets();
