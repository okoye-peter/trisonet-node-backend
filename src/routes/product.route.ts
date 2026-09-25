import { Router } from "express";
import { validate } from "../middlewares/validateRequest";
import { optionalAuth } from "../middlewares/auth";
import { listProductsSchema, getProductSchema } from "../validations/product.validation";
import { getProductReviewsSchema } from "../validations/review.validation";
import { listProducts, getProduct, getProductReviews } from "../controllers/product.controller";

const router = Router();

// optionalAuth only to know who is browsing: partner products are shown to the seller beta only.
router.get('/', optionalAuth, validate(listProductsSchema), listProducts);
router.get('/:id/reviews', validate(getProductReviewsSchema), getProductReviews);
router.get('/:id', optionalAuth, validate(getProductSchema), getProduct);

export default router;
