import "dotenv/config";
import { prisma, Prisma } from "../config/prisma";
import NotificationService from "../services/notification.service";

/**
 * One-off ops script: cancels every auction listing currently in "active" status
 * (open for bidding, no winner locked in yet), refunds the seller's escrowed GKWTH,
 * and deletes the listing along with everything that cascades from it (bids,
 * transactions, reviews, claims — see onDelete: Cascade in schema.prisma).
 *
 * Deliberately scoped to "active" only — listings in ended/awaiting_payment/completed
 * already have a winner locked in or money moved and must never be touched by this.
 *
 * Bids place no funds in escrow (see AuctionService.placeBid), so bidders need no
 * wallet reversal — only a heads-up notification.
 *
 * Dry-run by default. Pass --commit to actually apply changes.
 */
const DRY_RUN = !process.argv.includes("--commit");

async function main() {
    const listings = await prisma.auctionListing.findMany({
        where: { status: "active" },
        include: { bids: true },
    });

    console.log(`Found ${listings.length} active auction listing(s).`);
    if (DRY_RUN) {
        console.log("DRY RUN — nothing will be changed. Re-run with --commit to apply.\n");
    } else {
        console.log("COMMIT MODE — this will refund sellers and permanently delete these listings.\n");
    }

    let cancelledCount = 0;
    let refundedTotal = 0;
    let bidsRemoved = 0;

    for (const listing of listings) {
        const openBidderIds = [...new Set(listing.bids.filter((b) => b.status === "pending" || b.status === "superseded").map((b) => b.bidderId))];

        console.log(
            `Auction #${listing.id}: seller ${listing.sellerId}, refund ${listing.gkwthAmount} GKWTH, ` +
            `${listing.bids.length} bid row(s) (${openBidderIds.length} distinct open bidder(s)) will be deleted.`
        );

        if (DRY_RUN) continue;

        const cancelled = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Re-check status inside the transaction so a listing that settled between the
            // findMany above and now (e.g. cron sweep, buy-it-now) is never touched.
            const current = await tx.auctionListing.findFirst({ where: { id: listing.id, status: "active" } });
            if (!current) return false;

            await tx.wallet.update({
                where: { id: listing.sellerWalletId },
                data: { amount: { increment: listing.gkwthAmount } },
            });

            // Cascades to auction_bids / auction_transactions / auction_reviews / auction_claims.
            await tx.auctionListing.delete({ where: { id: listing.id } });
            return true;
        });

        if (!cancelled) {
            console.log(`  Skipped #${listing.id} — no longer active by the time we got to it.`);
            continue;
        }

        cancelledCount += 1;
        refundedTotal += listing.gkwthAmount;
        bidsRemoved += listing.bids.length;

        await NotificationService.createNotification(
            [listing.sellerId],
            "Auction Cancelled",
            `Your auction for ${listing.gkwthAmount} GKWTH was cancelled by an admin and your GKWTH has been returned to your wallet. You're free to create a new listing any time.`
        ).catch((err) => console.error(`  Failed to notify seller ${listing.sellerId}:`, err));

        for (const bidderId of openBidderIds) {
            await NotificationService.createNotification(
                [bidderId],
                "Auction Cancelled",
                "An auction you bid on was cancelled by an admin. No funds were held for your bid, so there's nothing to refund on your end."
            ).catch((err) => console.error(`  Failed to notify bidder ${bidderId}:`, err));
        }
    }

    console.log(
        `\n${DRY_RUN ? "Would cancel" : "Cancelled"} ${listings.length} listing(s)` +
        (DRY_RUN ? "" : ` — actually cancelled ${cancelledCount}, refunded ${refundedTotal} GKWTH total, removed ${bidsRemoved} bid row(s).`)
    );
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
