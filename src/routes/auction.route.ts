import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { requireAuctionEligibility } from "../middlewares/requireLevel";
import { validate } from "../middlewares/validateRequest";
import { createAuctionSchema, placeBidSchema, rejectBidSchema, submitReviewSchema } from "../validations/auction.validation";
import {
    getAuctionSettings,
    createAuction,
    listAuctions,
    getMyAuctions,
    getMyBidHistory,
    getAuctionDetail,
    placeBid,
    buyItNow,
    acceptBid,
    rejectBid,
    claimAuction,
    endEarly,
    getAuctionTransaction,
    submitReview,
} from "../controllers/auction.controller";

const router = Router();

router.use(protect);
router.use(isBlocked);
router.use(requireAuctionEligibility);

router.get("/settings", getAuctionSettings);
router.get("/", listAuctions);
router.get("/mine", getMyAuctions);
router.get("/my-bids", getMyBidHistory);
router.get("/:id", getAuctionDetail);
router.get("/:id/transaction", getAuctionTransaction);
router.post("/", validate(createAuctionSchema), createAuction);
router.post("/:id/bids", validate(placeBidSchema), placeBid);
router.post("/:id/buy-now", buyItNow);
router.post("/:id/bids/:bidId/accept", acceptBid);
router.post("/:id/bids/:bidId/reject", validate(rejectBidSchema), rejectBid);
router.post("/:id/claim", claimAuction);
router.post("/:id/end-early", endEarly);
router.post("/:id/review", validate(submitReviewSchema), submitReview);

export default router;
