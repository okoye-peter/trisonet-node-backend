import { prisma, Prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { paginate } from "../utils/pagination";
import NotificationService from "./notification.service";
import { getIO } from "../sockets";
import { CreateAuctionInput, PlaceBidInput, SubmitReviewInput } from "../validations/auction.validation";
import { PagaService } from "./paga.service";
import { ROLES, WITHDRAWAL_STATUSES, PAGA } from "../config/constants";

const OPEN_BID_STATUSES: Array<"pending" | "superseded" | "accepted"> = ["pending", "superseded", "accepted"];
const REFUNDABLE_BID_STATUSES: Array<"pending" | "superseded"> = ["pending", "superseded"];
const CRON_SWEEP_BATCH_LIMIT = 20;
const CLAIM_WINDOW_HOURS = 48;
const COMMISSION_SETTING_KEY = "auction_payment_percentage_charges";
// Surcharge added on top of a claim's amount for card payments only (bank transfer already has
// Paga's own collection fee borne by the payer — see generateVirtualAccount). Does not affect
// platformFee/netAmount, which are always computed from winningBid.amount, not what was paid.
const CARD_CHARGE_SETTING_KEY = "auction_card_charge_percentage";

const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 720; // 30 days — sellers can also pick a custom duration outside the presets

function generateReference(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/** Best-effort notification — never let a notification failure fail the money-moving flow it follows. */
async function notify(userIds: bigint[], title: string, body: string) {
    try {
        await NotificationService.createNotification(userIds, title, body);
    } catch (error) {
        console.error("[AuctionService] Failed to send notification:", error);
    }
}

/** Best-effort socket emit — same non-blocking guarantee as notifications. */
function emitToUser(userId: bigint, event: string, payload: Record<string, unknown>) {
    try {
        getIO().to(`user:${userId.toString()}`).emit(event, payload);
    } catch (error) {
        console.error("[AuctionService] Failed to emit socket event:", error);
    }
}

export class AuctionService {
    /**
     * Public settings a bidder/seller should see before acting: the commission rate charged on
     * a completed sale, and the seller-side listing limits. Used by the create-auction flow to
     * show real terms up front instead of a hardcoded guess.
     */
    static async getAuctionSettings() {
        const settingsKeys = ["lock_auction", COMMISSION_SETTING_KEY, CARD_CHARGE_SETTING_KEY, "auction_min_gkwth_amount", "auction_max_price"];
        const settings = await prisma.setting.findMany({ where: { key: { in: settingsKeys } } });
        const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

        return {
            locked: settingsMap["lock_auction"] === "1",
            commissionPercent: Number(settingsMap[COMMISSION_SETTING_KEY] || 0.5),
            cardChargePercent: Number(settingsMap[CARD_CHARGE_SETTING_KEY] || 1.5),
            minGkwthAmount: Number(settingsMap["auction_min_gkwth_amount"] || 1),
            maxPrice: Number(settingsMap["auction_max_price"] || 0) || null,
        };
    }

    /**
     * Create a new auction listing, locking the seller's GKWTH (indirect wallet) immediately.
     */
    static async createListing(user: any, input: CreateAuctionInput) {
        const settingsKeys = ["lock_auction", COMMISSION_SETTING_KEY, "auction_min_gkwth_amount", "auction_max_price"];
        const settings = await prisma.setting.findMany({ where: { key: { in: settingsKeys } } });
        const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

        if (settingsMap["lock_auction"] === "1") {
            throw new AppError("Auctions are currently not available, try again later", 400);
        }

        if (!user.status) {
            throw new AppError("Your account isn't activated, activate your account first", 400);
        }

        if (!user.bank || !user.accountNumber) {
            throw new AppError("Please add your bank account details before placing GKWTH for auction", 400);
        }

        const minGkwthAmount = Number(settingsMap["auction_min_gkwth_amount"] || 1);
        if (input.gkwthAmount < minGkwthAmount) {
            throw new AppError(`Minimum GKWTH amount to auction is ${minGkwthAmount}`, 400);
        }

        const maxPrice = Number(settingsMap["auction_max_price"] || 0) || Infinity;
        if (input.startingBid > maxPrice) {
            throw new AppError(`Starting bid cannot exceed the maximum auction price of ₦${maxPrice.toLocaleString()}`, 400);
        }
        if (input.buyItNowPrice && input.buyItNowPrice > maxPrice) {
            throw new AppError(`Buy It Now price cannot exceed the maximum auction price of ₦${maxPrice.toLocaleString()}`, 400);
        }

        if (input.buyItNowPrice && input.buyItNowPrice <= input.startingBid) {
            throw new AppError("Buy It Now price must be higher than the starting bid", 400);
        }

        if (input.durationHours < MIN_DURATION_HOURS || input.durationHours > MAX_DURATION_HOURS) {
            throw new AppError(`Auction duration must be between ${MIN_DURATION_HOURS} and ${MAX_DURATION_HOURS} hours`, 400);
        }

        const sellerWallet = await prisma.wallet.findFirst({ where: { userId: user.id, type: "indirect" } });
        if (!sellerWallet) {
            throw new AppError("You don't have a GKWTH wallet", 400);
        }

        const maxSellableGkwth = Number(Math.max(0, sellerWallet.amount - 1).toFixed(2));
        if (input.gkwthAmount > maxSellableGkwth) {
            throw new AppError(
                `You can put up to ${maxSellableGkwth} GKWTH up for sale. 1 GKWTH must always stay in your wallet, and your wallet currently holds ${sellerWallet.amount}.`,
                400
            );
        }

        const startsAt = new Date();
        const endsAt = new Date(startsAt.getTime() + input.durationHours * 60 * 60 * 1000);

        const listing = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const currentWallet = await tx.wallet.findUnique({ where: { id: sellerWallet.id } });
            if (!currentWallet || currentWallet.amount - input.gkwthAmount < 1) {
                throw new AppError("Insufficient GKWTH balance", 400);
            }

            await tx.wallet.update({
                where: { id: sellerWallet.id },
                data: { amount: { decrement: input.gkwthAmount } },
            });

            return tx.auctionListing.create({
                data: {
                    sellerId: user.id,
                    sellerWalletId: sellerWallet.id,
                    gkwthAmount: input.gkwthAmount,
                    startingBid: input.startingBid,
                    buyItNowPrice: input.buyItNowPrice ?? null,
                    minIncrement: input.minIncrement || 1000,
                    visibility: input.visibility || "public",
                    status: "active",
                    startsAt,
                    endsAt,
                },
            });
        });

        await notify(
            [user.id],
            "Auction Created",
            `Your auction for ${input.gkwthAmount} GKWTH is now live and open for bidding.`
        );

        // Let the right audience know a new auction is available without them having to visit the auction page.
        await this.announceNewListing(user, listing);

        return listing;
    }

    /**
     * Let people who could actually bid on this listing know it exists, so availability isn't
     * something you only discover by visiting the auction page. Public auctions reach every
     * eligible active user; followers-only auctions reach just the seller's eligible followers;
     * private auctions aren't announced (visibility is enforced in getListingDetail too).
     *
     * Audience is restricted to the same eligibility rules as requireAuctionEligibility
     * (customer, level >= 2, adult, active, not blocked) — level 1 customers can't access the
     * auction feature at all, so they must never be notified about it either.
     */
    private static async announceNewListing(seller: any, listing: { id: bigint; gkwthAmount: number; startingBid: number; visibility: string }) {
        try {
            const eligibleAudienceWhere = {
                role: ROLES.CUSTOMER,
                isInfant: false,
                level: { gte: 2 },
                status: true,
                blockedAt: null,
            } as const;

            let audience: bigint[] = [];

            if (listing.visibility === "public") {
                const users = await prisma.user.findMany({
                    where: { ...eligibleAudienceWhere, id: { not: seller.id } },
                    select: { id: true },
                });
                audience = users.map((u) => u.id);
            } else if (listing.visibility === "followers") {
                const followers = await prisma.follow.findMany({ where: { followingId: seller.id }, select: { followerId: true } });
                const followerIds = followers.map((f) => f.followerId);
                if (followerIds.length > 0) {
                    const users = await prisma.user.findMany({
                        where: { ...eligibleAudienceWhere, id: { in: followerIds } },
                        select: { id: true },
                    });
                    audience = users.map((u) => u.id);
                }
            }

            if (audience.length === 0) return;

            await notify(
                audience,
                "New GKWTH Auction Available",
                `${seller.name || "A seller"} just listed ${listing.gkwthAmount} GKWTH for auction, starting at ₦${listing.startingBid.toLocaleString()}.`
            );

            for (const userId of audience) {
                emitToUser(userId, "AuctionCreatedEvent", { listingId: listing.id.toString(), visibility: listing.visibility });
            }
        } catch (error) {
            console.error("[AuctionService] Failed to announce new listing:", error);
        }
    }

    /**
     * Compute the derived stats (current top bid, min next bid, counts) for a listing given its bids.
     */
    private static deriveListingStats(listing: { startingBid: number; minIncrement: number }, bids: Array<{ bidderId: bigint; amount: number; status: string }>) {
        const openBids = bids.filter((b) => OPEN_BID_STATUSES.includes(b.status as any));
        const currentTopBid = openBids.length > 0 ? Math.max(...openBids.map((b) => b.amount)) : listing.startingBid;
        const minNextBid = openBids.length > 0 ? currentTopBid + listing.minIncrement : listing.startingBid;
        const bidCount = bids.length;
        const bidderCount = new Set(bids.map((b) => b.bidderId.toString())).size;
        return { currentTopBid, minNextBid, bidCount, bidderCount };
    }

    private static async getSellerReputations(sellerIds: bigint[]) {
        const uniqueIds = Array.from(new Set(sellerIds.map((id) => id.toString()))).map((id) => BigInt(id));

        const map = new Map<string, { completedAuctions: number; averageRating: number | null; reviewCount: number }>();
        for (const id of uniqueIds) {
            map.set(id.toString(), { completedAuctions: 0, averageRating: null, reviewCount: 0 });
        }

        if (uniqueIds.length === 0) return map;

        const [completedCounts, ratingAgg] = await Promise.all([
            prisma.auctionListing.groupBy({
                by: ["sellerId"],
                where: { sellerId: { in: uniqueIds }, status: "completed" },
                _count: { _all: true },
            }),
            prisma.auctionReview.groupBy({
                by: ["sellerId"],
                where: { sellerId: { in: uniqueIds } },
                _avg: { rating: true },
                _count: { rating: true },
            }),
        ]);

        for (const row of completedCounts) {
            const entry = map.get(row.sellerId.toString());
            if (entry) entry.completedAuctions = row._count._all;
        }
        for (const row of ratingAgg) {
            const entry = map.get(row.sellerId.toString());
            if (entry) {
                entry.averageRating = row._avg.rating !== null ? Math.round(row._avg.rating * 10) / 10 : null;
                entry.reviewCount = row._count.rating;
            }
        }

        return map;
    }

    static async listAuctions(user: any | null, filters: { page?: number | undefined; limit?: number | undefined; status?: string | undefined; search?: string | undefined; sort?: string | undefined }) {
        const where: any = {
            OR: [
                { visibility: "public" },
                ...(user ? [{ sellerId: user.id }] : []),
            ],
        };

        if (filters.status) {
            where.status = filters.status;
        }

        if (filters.search) {
            where.seller = { name: { contains: filters.search } };
        }

        if (user) {
            const followedSellerIds = await prisma.follow.findMany({
                where: { followerId: user.id },
                select: { followingId: true },
            });
            const followedIds = followedSellerIds.map((f) => f.followingId);
            where.OR.push({ visibility: "followers", sellerId: { in: followedIds } });
        }

        let orderBy: any = { createdAt: "desc" };
        if (filters.sort === "ending_soon") orderBy = { endsAt: "asc" };

        const result = await paginate(
            prisma.auctionListing,
            {
                where,
                include: {
                    seller: { select: { id: true, name: true, pictureUrl: true } },
                    bids: { select: { bidderId: true, amount: true, status: true } },
                },
                orderBy,
            },
            { page: filters.page, limit: filters.limit }
        );

        const reputations = await this.getSellerReputations(result.data.map((listing: any) => listing.sellerId));

        let data = result.data.map((listing: any) => ({
            ...listing,
            ...this.deriveListingStats(listing, listing.bids),
            bids: undefined,
            sellerStats: reputations.get(listing.sellerId.toString()),
        }));

        if (filters.sort === "lowest_bid") {
            data = data.sort((a: any, b: any) => a.currentTopBid - b.currentTopBid);
        } else if (filters.sort === "most_bids") {
            data = data.sort((a: any, b: any) => b.bidCount - a.bidCount);
        }

        return { ...result, data };
    }

    static async getListingDetail(user: any | null, id: bigint) {
        const listing = await prisma.auctionListing.findUnique({
            where: { id },
            include: {
                seller: { select: { id: true, name: true, pictureUrl: true, createdAt: true } },
                bids: {
                    include: { bidder: { select: { id: true, name: true, pictureUrl: true } } },
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        if (!listing) {
            throw new AppError("Auction not found", 404);
        }

        if (listing.visibility === "private" && (!user || user.id !== listing.sellerId)) {
            throw new AppError("You don't have access to this auction", 403);
        }

        if (listing.visibility === "followers" && (!user || user.id !== listing.sellerId)) {
            const follows = await prisma.follow.findFirst({ where: { followerId: user.id, followingId: listing.sellerId } });
            if (!follows) {
                throw new AppError("This auction is only visible to the seller's followers", 403);
            }
        }

        const stats = this.deriveListingStats(listing, listing.bids);

        const sellerStats = (await this.getSellerReputations([listing.sellerId])).get(listing.sellerId.toString());

        let yourStanding: any = null;
        if (user) {
            const myBids = listing.bids.filter((b) => b.bidderId === user.id);
            const latest = myBids[0];
            if (latest) {
                const openBids = listing.bids.filter((b) => OPEN_BID_STATUSES.includes(b.status as any));
                const ranked = Object.values(
                    openBids.reduce((acc: Record<string, { bidderId: bigint; amount: number }>, b) => {
                        const key = b.bidderId.toString();
                        if (!acc[key] || acc[key].amount < b.amount) acc[key] = { bidderId: b.bidderId, amount: b.amount };
                        return acc;
                    }, {})
                ).sort((a: any, b: any) => b.amount - a.amount);
                const position = ranked.findIndex((r: any) => r.bidderId === user.id) + 1;

                yourStanding = {
                    lastBidAmount: latest.amount,
                    position: position || null,
                    totalBidders: ranked.length,
                    totalBidsPlaced: myBids.length,
                    isOutbid: latest.status === "superseded",
                };
            }
        }

        return {
            ...listing,
            ...stats,
            sellerStats,
            yourStanding,
        };
    }

    /**
     * Place a bid. Bids are non-custodial proposals — no wallet is touched, no money moves,
     * until the seller (or the cron sweep) picks a winner and that winner claims and pays.
     */
    static async placeBid(user: any, listingId: bigint, input: PlaceBidInput) {
        if (!user.status) {
            throw new AppError("Your account isn't activated, activate your account first", 400);
        }

        const bidderWallet = await prisma.wallet.findFirst({ where: { userId: user.id, type: "direct" } });
        if (!bidderWallet) {
            throw new AppError("You don't have a wallet to bid from", 400);
        }

        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const listing = await tx.auctionListing.findUnique({ where: { id: listingId } });
            if (!listing) throw new AppError("Auction not found", 404);
            if (listing.status !== "active") throw new AppError("This auction is not open for bidding", 400);
            if (listing.endsAt <= new Date()) throw new AppError("This auction has ended", 400);
            if (listing.sellerId === user.id) throw new AppError("You cannot bid on your own auction", 400);

            const openBids = await tx.auctionBid.findMany({
                where: { auctionListingId: listingId, status: { in: OPEN_BID_STATUSES } },
            });
            const currentTopBid = openBids.length > 0 ? Math.max(...openBids.map((b) => b.amount)) : listing.startingBid;
            const minNextBid = openBids.length > 0 ? currentTopBid + listing.minIncrement : listing.startingBid;

            if (input.amount < minNextBid) {
                throw new AppError(`Your bid must be at least ₦${minNextBid.toLocaleString()}`, 400);
            }

            // Supersede this bidder's own previous pending bid, if any, so they don't have two open proposals.
            const ownPreviousBid = openBids.find((b) => b.bidderId === user.id && b.status === "pending");
            if (ownPreviousBid) {
                await tx.auctionBid.update({ where: { id: ownPreviousBid.id }, data: { status: "refunded", refundedAt: new Date() } });
            }

            // Mark the current top bid (from a different bidder) as superseded.
            const previousTopBid = openBids
                .filter((b) => b.bidderId !== user.id && b.status === "pending")
                .sort((a, b) => b.amount - a.amount)[0];

            // A bid that meets or exceeds the seller's set (Buy It Now) price wins immediately —
            // the bidder doesn't have to wait for the auction timer to run out. They still have to
            // claim and pay before anything actually changes hands.
            const meetsSetPrice = listing.buyItNowPrice != null && input.amount >= listing.buyItNowPrice;

            const newBid = await tx.auctionBid.create({
                data: {
                    auctionListingId: listingId,
                    bidderId: user.id,
                    bidderWalletId: bidderWallet.id,
                    amount: input.amount,
                    status: meetsSetPrice ? "accepted" : "pending",
                },
            });

            if (!meetsSetPrice && previousTopBid) {
                await tx.auctionBid.update({ where: { id: previousTopBid.id }, data: { status: "superseded" } });
            }

            if (!meetsSetPrice) {
                return { newBid, listing, previousTopBid, claimDeadlineAt: null as Date | null };
            }

            const { claimDeadlineAt } = await this.moveToAwaitingPayment(tx, listing, newBid, "buy_it_now");
            return { newBid, listing, previousTopBid, claimDeadlineAt };
        });

        if (result.claimDeadlineAt) {
            await notify(
                [user.id],
                "You Won the Auction!",
                `Your bid of ₦${input.amount.toLocaleString()} met the seller's set price. Claim it and complete payment within 48 hours to receive your GKWTH.`
            );
            emitToUser(user.id, "AuctionBidAcceptedEvent", { listingId: listingId.toString() });

            await notify(
                [result.listing.sellerId],
                "Auction Matched Instantly",
                `Your auction matched instantly at ₦${input.amount.toLocaleString()} — a bid met your set price. Waiting for the buyer to complete payment.`
            );
            emitToUser(result.listing.sellerId, "AuctionEndedEvent", { listingId: listingId.toString(), reason: "instant_sale" });

            return result.newBid;
        }

        await notify([result.listing.sellerId], "New Bid Received", `A new bid of ₦${input.amount.toLocaleString()} was placed on your auction.`);
        emitToUser(result.listing.sellerId, "AuctionBidPlacedEvent", { listingId: listingId.toString(), amount: input.amount });

        if (result.previousTopBid) {
            await notify([result.previousTopBid.bidderId], "You've Been Outbid", `Someone placed a higher bid of ₦${input.amount.toLocaleString()} on an auction you bid on.`);
            emitToUser(result.previousTopBid.bidderId, "AuctionOutbidEvent", { listingId: listingId.toString(), amount: input.amount });
        }

        return result.newBid;
    }

    /**
     * Buy-It-Now: skip bidding entirely and lock in the fixed price as the winner immediately.
     * Like every other path to winning, this still requires the buyer to claim and pay via
     * Paga within the claim window before any GKWTH or money actually moves.
     */
    static async buyItNow(user: any, listingId: bigint) {
        if (!user.status) {
            throw new AppError("Your account isn't activated, activate your account first", 400);
        }

        const bidderWallet = await prisma.wallet.findFirst({ where: { userId: user.id, type: "direct" } });
        if (!bidderWallet) {
            throw new AppError("You don't have a wallet on file to buy from", 400);
        }

        const preCheckListing = await prisma.auctionListing.findUnique({ where: { id: listingId } });
        if (!preCheckListing || !preCheckListing.buyItNowPrice) {
            throw new AppError("Buy It Now is not available for this auction", 400);
        }
        if (preCheckListing.sellerId === user.id) {
            throw new AppError("You cannot buy your own auction", 400);
        }

        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const listing = await tx.auctionListing.findFirst({ where: { id: listingId, status: "active" } });
            if (!listing || !listing.buyItNowPrice) {
                throw new AppError("This auction is no longer available", 400);
            }
            if (listing.sellerId === user.id) {
                throw new AppError("You cannot buy your own auction", 400);
            }

            const winningBid = await tx.auctionBid.create({
                data: {
                    auctionListingId: listingId,
                    bidderId: user.id,
                    bidderWalletId: bidderWallet.id,
                    amount: listing.buyItNowPrice,
                    status: "accepted",
                    isBuyItNow: true,
                },
            });

            return this.moveToAwaitingPayment(tx, listing, winningBid, "buy_it_now");
        });

        await notify(
            [user.id],
            "You Won the Auction!",
            `Your Buy It Now purchase of ₦${result.listing.buyItNowPrice?.toLocaleString()} is confirmed. Claim it and complete payment within 48 hours to receive your GKWTH.`
        );
        emitToUser(user.id, "AuctionBidAcceptedEvent", { listingId: listingId.toString() });

        await notify(
            [result.listing.sellerId],
            "Auction Sold Instantly",
            `Your auction sold instantly via Buy It Now. Waiting for the buyer to complete payment.`
        );
        emitToUser(result.listing.sellerId, "AuctionEndedEvent", { listingId: listingId.toString(), reason: "instant_sale" });

        return result;
    }

    /**
     * Accept a specific bid (not necessarily the highest). Seller-only. Moves the auction into
     * awaiting_payment — the winning bidder must still claim and pay before anything settles.
     */
    static async acceptBid(sellerUser: any, listingId: bigint, bidId: bigint) {
        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const listing = await tx.auctionListing.findFirst({ where: { id: listingId, sellerId: sellerUser.id, status: { in: ["active", "ended"] } } });
            if (!listing) throw new AppError("Auction not found", 404);

            const bid = await tx.auctionBid.findFirst({
                where: { id: bidId, auctionListingId: listingId, status: { in: REFUNDABLE_BID_STATUSES } },
            });
            if (!bid) throw new AppError("This bid is no longer available to accept", 400);

            return this.moveToAwaitingPayment(tx, listing, bid, "accepted_bid");
        });

        await notify(
            [result.winningBid.bidderId],
            "Your Bid Was Accepted!",
            `Your bid of ₦${result.winningBid.amount.toLocaleString()} was accepted. Claim it and complete payment within 48 hours to receive your GKWTH.`
        );
        emitToUser(result.winningBid.bidderId, "AuctionBidAcceptedEvent", { listingId: listingId.toString() });

        emitToUser(sellerUser.id, "AuctionEndedEvent", { listingId: listingId.toString(), reason: "bid_accepted" });

        for (const loserId of result.losingBidderIds) {
            await notify([loserId], "Auction Ended", "An auction you bid on has ended — the seller accepted a different bid.");
            emitToUser(loserId, "AuctionEndedEvent", { listingId: listingId.toString(), reason: "bid_accepted_lost" });
        }

        return result;
    }

    /**
     * Reject a single bid — it was never backed by locked funds, so this is just a status change. Seller-only.
     */
    static async rejectBid(sellerUser: any, listingId: bigint, bidId: bigint) {
        const bid = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const listing = await tx.auctionListing.findUnique({ where: { id: listingId } });
            if (!listing || listing.sellerId !== sellerUser.id) {
                throw new AppError("Auction not found", 404);
            }

            const targetBid = await tx.auctionBid.findFirst({
                where: { id: bidId, auctionListingId: listingId, status: { in: REFUNDABLE_BID_STATUSES } },
            });
            if (!targetBid) throw new AppError("This bid is no longer available to reject", 400);

            await tx.auctionBid.update({ where: { id: targetBid.id }, data: { status: "rejected", refundedAt: new Date() } });

            return targetBid;
        });

        await notify([bid.bidderId], "Bid Declined", `Your bid of ₦${bid.amount.toLocaleString()} was declined by the seller.`);
        emitToUser(bid.bidderId, "AuctionEndedEvent", { listingId: listingId.toString(), reason: "bid_rejected" });

        return bid;
    }

    /**
     * Seller manually ends bidding early. If there are open bids, the highest one wins immediately
     * (same as a natural timeout) — the seller no longer gets a separate manual accept/reject step.
     * If there are none, cancels immediately and refunds the seller's locked GKWTH.
     */
    static async endEarly(sellerUser: any, listingId: bigint) {
        const listing = await prisma.auctionListing.findFirst({ where: { id: listingId, sellerId: sellerUser.id, status: "active" } });
        if (!listing) throw new AppError("Auction not found or not active", 404);

        const topBid = await prisma.auctionBid.findFirst({
            where: { auctionListingId: listingId, status: { in: REFUNDABLE_BID_STATUSES } },
            orderBy: { amount: "desc" },
        });

        if (!topBid) {
            return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                const updated = await tx.auctionListing.updateMany({ where: { id: listingId, status: "active" }, data: { status: "cancelled", cancelReason: "Ended early by seller with no bids" } });
                if (updated.count !== 1) throw new AppError("Auction not found or not active", 404);
                await tx.wallet.update({ where: { id: listing.sellerWalletId }, data: { amount: { increment: listing.gkwthAmount } } });
                return tx.auctionListing.findUniqueOrThrow({ where: { id: listingId } });
            });
        }

        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            return this.moveToAwaitingPayment(tx, listing, topBid, "ended_early");
        });

        await notify(
            [topBid.bidderId],
            "You Won the Auction!",
            `The seller ended the auction early and your bid of ₦${topBid.amount.toLocaleString()} was the highest. Claim it and complete payment within 48 hours to receive your GKWTH.`
        );
        emitToUser(topBid.bidderId, "AuctionBidAcceptedEvent", { listingId: listingId.toString() });
        emitToUser(sellerUser.id, "AuctionEndedEvent", { listingId: listingId.toString(), reason: "ended_early_settled" });

        for (const loserId of result.losingBidderIds) {
            await notify([loserId], "Auction Ended", "An auction you bid on ended early — another bid won.");
            emitToUser(loserId, "AuctionEndedEvent", { listingId: listingId.toString(), reason: "ended_early_lost" });
        }

        return result;
    }

    /**
     * A bid has just won (seller accepted it, it matched Buy It Now, or the cron sweep picked it
     * at expiry). Lock in the winner and give them a fixed window to claim and pay — no money or
     * GKWTH moves yet, that only happens once Paga confirms their payment (see finalizeAuctionPayment).
     */
    private static async moveToAwaitingPayment(
        tx: Prisma.TransactionClient,
        listing: { id: bigint; sellerId: bigint },
        winningBid: { id: bigint; bidderId: bigint; amount: number },
        settlementType: "accepted_bid" | "buy_it_now" | "cron_auto_accept" | "ended_early"
    ) {
        const claimDeadlineAt = new Date(Date.now() + CLAIM_WINDOW_HOURS * 60 * 60 * 1000);

        const updated = await tx.auctionListing.updateMany({
            where: { id: listing.id, status: { in: ["active", "ended"] } },
            data: { status: "awaiting_payment", acceptedBidId: winningBid.id, settlementType, claimDeadlineAt },
        });
        if (updated.count !== 1) {
            throw new AppError("This auction is no longer open for acceptance", 400);
        }

        await tx.auctionBid.update({ where: { id: winningBid.id }, data: { status: "accepted" } });

        // Every other open bid lost the moment a winner was locked in — no funds to release, just close them out.
        const otherOpenBids = await tx.auctionBid.findMany({
            where: { auctionListingId: listing.id, status: { in: REFUNDABLE_BID_STATUSES }, id: { not: winningBid.id } },
        });
        if (otherOpenBids.length > 0) {
            await tx.auctionBid.updateMany({
                where: { id: { in: otherOpenBids.map((b) => b.id) } },
                data: { status: "rejected" },
            });
        }

        const updatedListing = await tx.auctionListing.findUniqueOrThrow({ where: { id: listing.id } });
        return { listing: updatedListing, winningBid, claimDeadlineAt, losingBidderIds: otherOpenBids.map((b) => b.bidderId) };
    }

    /**
     * Called once Paga confirms the winning bidder's claim payment. Credits their GKWTH,
     * writes the audit transaction row, and flips the listing to completed. Bank payout to
     * the seller (minus commission) happens after this commits — see payoutSellerToBank.
     */
    private static async finalizeAuctionPayment(
        tx: Prisma.TransactionClient,
        listing: { id: bigint; sellerId: bigint; gkwthAmount: number; settlementType: string | null },
        winningBid: { id: bigint; bidderId: bigint; amount: number }
    ) {
        const commissionSetting = await tx.setting.findFirst({ where: { key: COMMISSION_SETTING_KEY } });
        const commissionPercent = Number(commissionSetting?.value || 0.5);
        const platformFee = winningBid.amount * (commissionPercent / 100);
        const netAmount = winningBid.amount - platformFee;

        const winnerGkwthWallet = await tx.wallet.findFirst({ where: { userId: winningBid.bidderId, type: "indirect" } });
        if (!winnerGkwthWallet) throw new AppError("Winning bidder has no GKWTH wallet", 400);

        // Seller is paid out via direct bank transfer after this transaction commits (see payoutSellerToBank).
        // Still require a direct wallet to exist as the fallback destination if that transfer fails.
        const sellerNairaWallet = await tx.wallet.findFirst({ where: { userId: listing.sellerId, type: "direct" } });
        if (!sellerNairaWallet) throw new AppError("Seller has no wallet to receive payment", 400);

        await tx.wallet.update({ where: { id: winnerGkwthWallet.id }, data: { amount: { increment: listing.gkwthAmount } } });

        const transaction = await tx.auctionTransaction.create({
            data: {
                auctionListingId: listing.id,
                winningBidId: winningBid.id,
                sellerId: listing.sellerId,
                buyerId: winningBid.bidderId,
                gkwthAmount: listing.gkwthAmount,
                grossAmount: winningBid.amount,
                platformFee,
                netAmount,
                settlementType: (listing.settlementType as any) || "accepted_bid",
                reference: generateReference("AUCTION"),
            },
        });

        return { transaction };
    }

    /**
     * The winning bidder claims their win and gets payment instructions. Idempotent within the
     * claim window — repeat calls return the same pending claim instead of minting a new one.
     * The buyer can pay either by bank transfer (virtual account) or card, whichever they prefer;
     * both settle the same claim reference through the Paga webhook.
     */
    static async claimAuction(user: any, listingId: bigint) {
        const listing = await prisma.auctionListing.findUnique({ where: { id: listingId } });
        if (!listing) throw new AppError("Auction not found", 404);
        if (listing.status !== "awaiting_payment" || !listing.acceptedBidId) {
            throw new AppError("This auction isn't awaiting payment", 400);
        }

        const winningBid = await prisma.auctionBid.findUnique({ where: { id: listing.acceptedBidId } });
        if (!winningBid || winningBid.bidderId !== user.id) {
            throw new AppError("You're not the winning bidder for this auction", 403);
        }

        if (!listing.claimDeadlineAt || listing.claimDeadlineAt <= new Date()) {
            throw new AppError("Your claim window has expired", 400);
        }

        const existingClaim = await prisma.auctionClaim.findFirst({
            where: { auctionListingId: listingId, buyerId: user.id, status: "pending" },
        });

        if (existingClaim) {
            return this.buildClaimResponse(existingClaim, user);
        }

        const pagaService = new PagaService();
        const reference = pagaService.generateReference("AUCTIONCLAIM");
        const response = await pagaService.generateVirtualAccount(winningBid.amount, user.name, user.phone, reference);
        if (!response.success) {
            throw new AppError(response.error || "Failed to generate payment details, please try again", 400);
        }

        const claim = await prisma.auctionClaim.create({
            data: {
                auctionListingId: listingId,
                bidId: winningBid.id,
                buyerId: user.id,
                amount: winningBid.amount,
                // Paga's payerCollectionFeeShare is set to 1, so it folds its own collection fee
                // into totalPaymentAmount — that's the real figure the buyer must transfer, not
                // the raw bid amount. Stored separately so settlement math (platformFee/netAmount)
                // stays anchored to winningBid.amount regardless of what Paga charges on top.
                transferAmount: response.data.amount,
                reference,
                status: "pending",
                accountName: response.data.account_name,
                bankName: response.data.bank_name,
                accountNumber: response.data.virtual_account,
                expiresAt: listing.claimDeadlineAt,
            },
        });

        return this.buildClaimResponse(claim, user);
    }

    /**
     * Bank transfer's payerCollectionFeeShare is set to 1 (see generateVirtualAccount), so the
     * buyer — not the platform — bears Paga's collection fee; transferAmount is the real,
     * fee-inclusive figure Paga expects and must be shown as the amount to send. Card payment
     * adds the admin-configured surcharge on top so the platform isn't left covering card
     * processing costs. Neither surcharge affects platformFee/netAmount, which are always
     * computed from winningBid.amount at settlement (see finalizeAuctionPayment).
     */
    private static async buildClaimResponse(claim: { reference: string; amount: number; transferAmount: number | null; expiresAt: Date; accountName: string | null; bankName: string | null; accountNumber: string | null }, user: any) {
        const { cardChargePercent } = await this.getAuctionSettings();
        const cardAmount = Number((claim.amount * (1 + cardChargePercent / 100)).toFixed(2));

        return {
            reference: claim.reference,
            amount: claim.amount,
            expiresAt: claim.expiresAt,
            bankTransfer: {
                accountName: claim.accountName,
                bankName: claim.bankName,
                accountNumber: claim.accountNumber,
                amount: claim.transferAmount ?? claim.amount,
            },
            cardPayment: {
                publicKey: PAGA.USERNAME,
                email: user.email,
                phoneNumber: user.phone || "",
                amount: cardAmount,
                chargePercent: cardChargePercent,
            },
        };
    }

    /**
     * Called from the Paga webhook (bank transfer or card, both route here by reference prefix)
     * once a claim payment is confirmed. Credits the buyer's GKWTH and pays the seller out minus
     * commission. If the listing is no longer awaiting this exact claim (e.g. the 48-hour window
     * already lapsed and it was cancelled before the payment landed), the money is credited to the
     * buyer's own wallet instead so it's never lost, and the mismatch is logged for reconciliation.
     */
    static async processClaimPayment(externalReferenceNumber: string, paymentAmount?: number) {
        const claim = await prisma.auctionClaim.findFirst({ where: { reference: externalReferenceNumber } });
        if (!claim) return { status: "not_found" };
        if (claim.status !== "pending") return { status: "already_processed" };
        if (paymentAmount != null && claim.amount > paymentAmount) return { status: "amount_mismatch" };

        const listing = await prisma.auctionListing.findUnique({ where: { id: claim.auctionListingId } });
        const winningBid = await prisma.auctionBid.findUnique({ where: { id: claim.bidId } });

        if (!listing || !winningBid || listing.status !== "awaiting_payment" || listing.acceptedBidId !== claim.bidId) {
            console.error(`[AuctionService] Claim ${claim.reference} paid but listing ${claim.auctionListingId} is no longer awaiting this payment — refunding to buyer's wallet.`);
            await prisma.auctionClaim.update({ where: { id: claim.id }, data: { status: "expired" } });
            const buyerWallet = await prisma.wallet.findFirst({ where: { userId: claim.buyerId, type: "direct" } });
            if (buyerWallet) {
                await prisma.wallet.update({ where: { id: buyerWallet.id }, data: { amount: { increment: claim.amount } } });
            }
            await notify(
                [claim.buyerId],
                "Auction Payment Received Late",
                `We received your payment of ₦${claim.amount.toLocaleString()} but the auction is no longer available (its claim window had already expired). The amount has been credited to your wallet instead.`
            );
            return { status: "listing_unavailable_refunded_to_wallet" };
        }

        const settled = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const updated = await tx.auctionListing.updateMany({ where: { id: listing.id, status: "awaiting_payment" }, data: { status: "completed" } });
            if (updated.count !== 1) return null;

            await tx.auctionClaim.update({ where: { id: claim.id }, data: { status: "paid" } });

            return this.finalizeAuctionPayment(tx, listing, winningBid);
        });

        if (!settled) return { status: "already_processed" };

        await this.payoutSellerToBank(settled.transaction.sellerId, settled.transaction.netAmount, settled.transaction.reference);

        await notify(
            [claim.buyerId],
            "Payment Confirmed!",
            `Your payment of ₦${claim.amount.toLocaleString()} was confirmed and ${listing.gkwthAmount} GKWTH has been credited to your wallet.`
        );
        emitToUser(claim.buyerId, "AuctionClaimPaidEvent", { listingId: listing.id.toString() });

        emitToUser(listing.sellerId, "AuctionClaimPaidEvent", { listingId: listing.id.toString() });

        return { status: "ok" };
    }

    /**
     * Send a settled auction's net proceeds straight to the seller's bank account via Paga.
     * Runs after the settlement transaction has committed (a real bank transfer must never
     * be tied to a DB transaction that could still roll back). On any failure — no bank
     * details, unresolvable bank, or a failed transfer — the funds are credited to the
     * seller's wallet instead so nothing is lost, and the seller is notified either way.
     */
    private static async payoutSellerToBank(sellerId: bigint, netAmount: number, auctionReference: string) {
        const creditWalletFallback = async (reason: string) => {
            const wallet = await prisma.wallet.findFirst({ where: { userId: sellerId, type: "direct" } });
            if (wallet) {
                await prisma.wallet.update({ where: { id: wallet.id }, data: { amount: { increment: netAmount } } });
            }
            await notify(
                [sellerId],
                "Auction Payout",
                `We couldn't send ₦${netAmount.toLocaleString()} from your auction sale to your bank account (${reason}). It has been credited to your wallet instead.`
            );
        };

        try {
            const seller = await prisma.user.findUnique({ where: { id: sellerId } });
            if (!seller) return;

            if (!seller.bank || !seller.accountNumber) {
                await creditWalletFallback("no bank account on file");
                return;
            }

            const paga = new PagaService();
            const bank = await paga.getBankByName(seller.bank);
            const bankUUID = bank?.uuid || bank?.bankUUID;
            if (!bankUUID) {
                await creditWalletFallback("your bank could not be verified");
                return;
            }

            const reference = paga.generateReference("AUCTION_PAYOUT");
            const payout = await paga.withdrawToBank(netAmount, bankUUID, seller.accountNumber, reference, {
                remarks: `Auction payout - ${auctionReference}`,
            });

            if (!payout.success) {
                await creditWalletFallback("the bank transfer failed");
                return;
            }

            const userTypeMap: Record<number, "customer" | "sponsor" | "influencer" | "admin"> = {
                [ROLES.SPONSOR]: "sponsor",
                [ROLES.INFLUENCER]: "influencer",
                [ROLES.SUPER_ADMIN]: "admin",
                [ROLES.ADMIN]: "admin",
            };

            await prisma.withDrawal.create({
                data: {
                    userId: sellerId,
                    amount: netAmount.toString(),
                    bankName: seller.bank,
                    accountNumber: seller.accountNumber,
                    isPaid: WITHDRAWAL_STATUSES.SUCCESS,
                    userType: userTypeMap[seller.role as number] || "customer",
                    userEmail: seller.email || seller.username || "",
                    reference,
                    pagaRef: payout.reference,
                    pagaTransactionId: payout.transaction_id,
                },
            });

            await notify(
                [sellerId],
                "Auction Payout Sent",
                `₦${netAmount.toLocaleString()} from your auction sale has been sent to your bank account.`
            );
        } catch (error) {
            console.error(`[AuctionService] Bank payout failed for seller ${sellerId}:`, error);
            await creditWalletFallback("an unexpected error occurred");
        }
    }

    /**
     * Cron sweep: pick a winner (or cancel) every active auction whose end time has passed,
     * and separately cancel any awaiting_payment auction whose 48-hour claim window lapsed
     * without payment, returning the seller's GKWTH.
     */
    static async cronSweepExpiredAuctions() {
        await this.sweepExpiredBidding();
        await this.sweepExpiredClaims();
    }

    private static async sweepExpiredBidding() {
        const expired = await prisma.auctionListing.findMany({
            where: { status: "active", endsAt: { lte: new Date() } },
            take: CRON_SWEEP_BATCH_LIMIT,
        });

        for (const listing of expired) {
            try {
                const topBid = await prisma.auctionBid.findFirst({
                    where: { auctionListingId: listing.id, status: { in: REFUNDABLE_BID_STATUSES } },
                    orderBy: { amount: "desc" },
                });

                if (!topBid) {
                    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                        const updated = await tx.auctionListing.updateMany({ where: { id: listing.id, status: "active" }, data: { status: "cancelled", cancelReason: "Expired with no bids" } });
                        if (updated.count !== 1) return;
                        await tx.wallet.update({ where: { id: listing.sellerWalletId }, data: { amount: { increment: listing.gkwthAmount } } });
                    });
                    emitToUser(listing.sellerId, "AuctionEndedEvent", { listingId: listing.id.toString(), reason: "expired_cancelled" });
                    await notify([listing.sellerId], "Auction Ended", `Your auction for ${listing.gkwthAmount} GKWTH expired with no bids. Your GKWTH has been returned.`);
                    continue;
                }

                const moved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                    return this.moveToAwaitingPayment(tx, listing, topBid, "cron_auto_accept");
                });

                emitToUser(listing.sellerId, "AuctionEndedEvent", { listingId: listing.id.toString(), reason: "auto_settled" });
                await notify(
                    [topBid.bidderId],
                    "You Won an Auction!",
                    `Your bid of ₦${topBid.amount.toLocaleString()} was the highest when the auction ended. Claim it and complete payment within 48 hours to receive your GKWTH.`
                );
                emitToUser(topBid.bidderId, "AuctionBidAcceptedEvent", { listingId: listing.id.toString() });

                for (const loserId of moved.losingBidderIds) {
                    await notify([loserId], "Auction Ended", "An auction you bid on has ended — another bid won.");
                    emitToUser(loserId, "AuctionEndedEvent", { listingId: listing.id.toString(), reason: "auto_settled_lost" });
                }
            } catch (error) {
                console.error(`[AuctionService] Failed to sweep listing ${listing.id}:`, error);
            }
        }
    }

    /**
     * Auctions sitting in awaiting_payment whose 48-hour claim deadline has passed without a
     * confirmed payment are cancelled outright and the seller's GKWTH is returned — the win is
     * not offered to the next-highest bidder.
     */
    private static async sweepExpiredClaims() {
        const expired = await prisma.auctionListing.findMany({
            where: { status: "awaiting_payment", claimDeadlineAt: { lte: new Date() } },
            take: CRON_SWEEP_BATCH_LIMIT,
        });

        for (const listing of expired) {
            try {
                const winningBid = listing.acceptedBidId
                    ? await prisma.auctionBid.findUnique({ where: { id: listing.acceptedBidId } })
                    : null;

                await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                    const updated = await tx.auctionListing.updateMany({
                        where: { id: listing.id, status: "awaiting_payment" },
                        data: { status: "cancelled", cancelReason: "Winning bidder did not complete payment within 48 hours" },
                    });
                    if (updated.count !== 1) return;

                    await tx.wallet.update({ where: { id: listing.sellerWalletId }, data: { amount: { increment: listing.gkwthAmount } } });

                    await tx.auctionClaim.updateMany({
                        where: { auctionListingId: listing.id, status: "pending" },
                        data: { status: "expired" },
                    });
                });

                emitToUser(listing.sellerId, "AuctionEndedEvent", { listingId: listing.id.toString(), reason: "claim_expired" });
                await notify(
                    [listing.sellerId],
                    "Auction Cancelled — Buyer Didn't Pay",
                    `The winning bidder for your ${listing.gkwthAmount} GKWTH auction didn't complete payment within 48 hours. Your GKWTH has been returned.`
                );

                if (winningBid) {
                    emitToUser(winningBid.bidderId, "AuctionEndedEvent", { listingId: listing.id.toString(), reason: "claim_expired_missed" });
                    await notify(
                        [winningBid.bidderId],
                        "You Missed Your Claim Window",
                        `You didn't complete payment within 48 hours for the auction you won, so it was cancelled and offered back to the seller.`
                    );
                }
            } catch (error) {
                console.error(`[AuctionService] Failed to sweep expired claim for listing ${listing.id}:`, error);
            }
        }
    }

    static async getMyAuctions(user: any) {
        const [active, past, totalBidsReceived, earned] = await Promise.all([
            prisma.auctionListing.findMany({
                where: { sellerId: user.id, status: { in: ["active", "ended", "awaiting_payment", "scheduled"] } },
                include: {
                    bids: { include: { bidder: { select: { id: true, name: true, pictureUrl: true } } }, orderBy: { amount: "desc" } },
                },
                orderBy: { createdAt: "desc" },
            }),
            prisma.auctionListing.findMany({
                where: { sellerId: user.id, status: { in: ["completed", "cancelled"] } },
                include: { transactions: true },
                orderBy: { updatedAt: "desc" },
                take: 20,
            }),
            prisma.auctionBid.count({ where: { auctionListing: { sellerId: user.id } } }),
            prisma.auctionTransaction.aggregate({ where: { sellerId: user.id }, _sum: { netAmount: true } }),
        ]);

        return {
            active: active.map((listing) => ({ ...listing, ...this.deriveListingStats(listing, listing.bids) })),
            past,
            stats: {
                activeCount: active.filter((a) => a.status === "active").length,
                totalBidsReceived,
                totalEarnedAllTime: earned._sum.netAmount || 0,
            },
        };
    }

    /**
     * A buyer's history of auctions they've bid on — filterable by outcome (active / pending /
     * awaiting_payment / won / lost). "Won" is determined by an auction_transaction with
     * buyerId = user (only created once Paga confirms their claim payment), not by acceptedBidId
     * alone. "ended" listings sit in limbo until the seller accepts a bid, so they're "pending"
     * rather than "lost" until the seller decides. "awaiting_payment" means this bid won but the
     * buyer still needs to claim and pay within the 48-hour window.
     */
    static async getMyBidHistory(user: any, filters: { page?: number | undefined; limit?: number | undefined; result?: string | undefined }) {
        const where: any = { bids: { some: { bidderId: user.id } } };

        if (filters.result === "active") {
            where.status = "active";
        } else if (filters.result === "pending") {
            where.status = "ended";
        } else if (filters.result === "awaiting_payment") {
            where.status = "awaiting_payment";
            where.bids = { some: { bidderId: user.id, status: "accepted" } };
        } else if (filters.result === "won") {
            where.status = "completed";
            where.transactions = { some: { buyerId: user.id } };
        } else if (filters.result === "lost") {
            where.status = { in: ["completed", "cancelled", "awaiting_payment"] };
            where.NOT = { transactions: { some: { buyerId: user.id } } };
        }

        const result = await paginate(
            prisma.auctionListing,
            {
                where,
                include: {
                    seller: { select: { id: true, name: true, pictureUrl: true } },
                    bids: { where: { bidderId: user.id }, orderBy: { amount: "desc" } },
                    transactions: { where: { buyerId: user.id } },
                },
                orderBy: { createdAt: "desc" },
            },
            { page: filters.page, limit: filters.limit }
        );

        const data = result.data.map((listing: any) => {
            const won = listing.transactions.length > 0;
            const isAcceptedBidder = listing.bids.some((b: any) => b.status === "accepted");
            const outcome =
                listing.status === "active" ? "active" :
                listing.status === "ended" ? "pending" :
                listing.status === "awaiting_payment" ? (isAcceptedBidder ? "awaiting_payment" : "lost") :
                won ? "won" : "lost";
            return {
                ...listing,
                yourBid: listing.bids.length > 0 ? Math.max(...listing.bids.map((b: any) => b.amount)) : 0,
                outcome,
                transaction: listing.transactions[0] ?? null,
                bids: undefined,
                transactions: undefined,
            };
        });

        const [activeBidsCount, wonCount, spent] = await Promise.all([
            prisma.auctionListing.count({ where: { status: "active", bids: { some: { bidderId: user.id } } } }),
            prisma.auctionTransaction.count({ where: { buyerId: user.id } }),
            prisma.auctionTransaction.aggregate({ where: { buyerId: user.id }, _sum: { grossAmount: true } }),
        ]);

        return {
            ...result,
            data,
            stats: {
                activeBidsCount,
                wonCount,
                totalSpent: spent._sum.grossAmount || 0,
            },
        };
    }

    static async getTransactionForListing(user: any, listingId: bigint) {
        const transaction = await prisma.auctionTransaction.findFirst({
            where: { auctionListingId: listingId },
            include: {
                auctionListing: { include: { seller: { select: { id: true, name: true, pictureUrl: true } } } },
            },
            orderBy: { createdAt: "desc" },
        });

        if (!transaction) {
            throw new AppError("Transaction not found", 404);
        }

        if (transaction.buyerId !== user.id && transaction.sellerId !== user.id) {
            throw new AppError("You don't have access to this transaction", 403);
        }

        return transaction;
    }

    static async submitReview(user: any, listingId: bigint, input: SubmitReviewInput) {
        const listing = await prisma.auctionListing.findUnique({ where: { id: listingId } });
        if (!listing || listing.status !== "completed") {
            throw new AppError("You can only review a completed auction", 400);
        }

        if (!listing.acceptedBidId) {
            throw new AppError("This auction has no accepted bid", 400);
        }

        const winningBid = await prisma.auctionBid.findFirst({ where: { id: listing.acceptedBidId } });
        if (!winningBid || winningBid.bidderId !== user.id) {
            throw new AppError("Only the winning bidder can review this auction", 403);
        }

        try {
            return await prisma.auctionReview.create({
                data: {
                    auctionListingId: listingId,
                    reviewerId: user.id,
                    sellerId: listing.sellerId,
                    rating: input.rating,
                    comment: input.comment ?? null,
                },
            });
        } catch (error: any) {
            if (error.code === "P2002") {
                throw new AppError("You've already reviewed this auction", 400);
            }
            throw error;
        }
    }
}

export default AuctionService;
