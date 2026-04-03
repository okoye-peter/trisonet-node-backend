import { prisma } from "../config/prisma.js";

async function deepCleanWallets() {
    console.log("Starting DEEP CLEAN wallet data repair...");

    const validTypes = ['direct', 'indirect', 'central_treasury', 'patronage', 'earning'];
    const validTypesStr = validTypes.map(t => `'${t}'`).join(', ');

    try {
        // 1. Identify invalid wallets for reporting
        const invalidWallets: any[] = await prisma.$queryRawUnsafe(`
            SELECT id, user_id, type FROM wallets 
            WHERE type NOT IN (${validTypesStr}) OR type IS NULL OR type = ''
        `);

        console.log(`Found ${invalidWallets.length} wallets with invalid or corrupt types.`);

        if (invalidWallets.length > 0) {
            // 2. Perform raw batch update to bypass Prisma mapping errors
            console.log("Applying batch repair via raw SQL...");
            const updatedCount = await prisma.$executeRawUnsafe(`
                UPDATE wallets 
                SET type = 'direct' 
                WHERE type NOT IN (${validTypesStr}) OR type IS NULL OR type = ''
            `);
            
            console.log(`Successfully repaired ${updatedCount} wallets in the database.`);
        } else {
            console.log("Database matches schema enums. No repair needed.");
        }

    } catch (error: any) {
        console.error("Error during deep clean:", error.message);
    } finally {
        await prisma.$disconnect();
    }
}

deepCleanWallets();

