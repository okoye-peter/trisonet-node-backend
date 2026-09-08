import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { validate } from "../middlewares/validateRequest";
import { createReviewSchema } from "../validations/review.validation";
import { getReviewableOrderItems, createReview } from "../controllers/review.controller";

const router = Router();

router.use(protect);
router.use(isBlocked);

router.get('/reviewable', getReviewableOrderItems);
router.post('/', validate(createReviewSchema), createReview);

export default router;
