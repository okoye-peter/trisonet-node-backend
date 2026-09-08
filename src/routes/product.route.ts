import { Router } from "express";
import { validate } from "../middlewares/validateRequest";
import { listProductsSchema, getProductSchema } from "../validations/product.validation";
import { getProductReviewsSchema } from "../validations/review.validation";
import { listProducts, getProduct, getProductReviews } from "../controllers/product.controller";

const router = Router();

router.get('/', validate(listProductsSchema), listProducts);
router.get('/:id/reviews', validate(getProductReviewsSchema), getProductReviews);
router.get('/:id', validate(getProductSchema), getProduct);

export default router;
