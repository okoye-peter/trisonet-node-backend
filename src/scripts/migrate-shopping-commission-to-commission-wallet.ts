import { prisma, WalletType } from "../config/prisma.js";

/**
 * One-time backfill for the ecommerce-commission/wallet split.
 *
 * Store-invite commission used to be paid into the "shopping" wallet, which also
 * holds unrelated return/store-credit money credited by the PHP side. This moves
 * each user's already-earned commission (summed from commissionLog rows of type
 * 'store_invite', status 'success') out of their "shopping" wallet balance into a
 * new "commission" wallet, capped at whatever the shopping wallet still holds (a
 * user may have already spent some of it as store credit at checkout).
 *
 * Safe to re-run: it only moves min(lifetimeCommission, currentShoppingBalance) once
 * per user by tagging the move with a marker in the commission wallet - subsequent
 * runs skip users who already have a commission wallet.
 */
async function migrateShoppingCommissionToCommissionWallet() {
    console.log("Starting shopping -> commission wallet backfill...");

    const commissionTotals = await prisma.commissionLog.groupBy({
        by: ['recipientId'],
        where: { type: 'store_invite', status: 'success', recipientId: { not: null } },
        _sum: { amount: true },
    });

    console.log(`Found ${commissionTotals.length} users with historical store-invite commission.`);

    let migrated = 0;
    let skipped = 0;

    for (const row of commissionTotals) {
        const userId = row.recipientId!;
        const lifetimeCommission = Number(row._sum.amount ?? 0);
        if (lifetimeCommission <= 0) {
            skipped++;
            continue;
        }

        await prisma.$transaction(async (tx) => {
            const existingCommissionWallet = await tx.wallet.findUnique({
                where: { userId_type: { userId, type: WalletType.commission } },
            });
            if (existingCommissionWallet) {
                // Already migrated for this user - never double-move.
                skipped++;
                return;
            }

            const shoppingWallet = await tx.wallet.findUnique({
                where: { userId_type: { userId, type: WalletType.shopping } },
            });
            const shoppingBalance = Number(shoppingWallet?.amount ?? 0);
            const amountToMove = Math.min(lifetimeCommission, shoppingBalance);

            if (amountToMove <= 0) {
                // They earned commission historically but have already spent it all
                // as store credit - nothing left to carry over.
                skipped++;
                return;
            }

            if (shoppingWallet) {
                await tx.wallet.update({
                    where: { id: shoppingWallet.id },
                    data: { amount: { decrement: amountToMove } },
                });
            }

            await tx.wallet.create({
                data: { userId, type: WalletType.commission, amount: amountToMove },
            });

            migrated++;
        });
    }

    console.log(`Done. Migrated ${migrated} users, skipped ${skipped}.`);
}

migrateShoppingCommissionToCommissionWallet()
    .catch((error) => {
        console.error("Backfill failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
