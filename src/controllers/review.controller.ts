import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import * as ReviewService from "../services/review.service";

export const getReviewableOrderItems = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const items = await ReviewService.getReviewableOrderItems(user.id);
    sendSuccess(res, 200, 'Reviewable items fetched successfully', items);
});

export const createReview = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const { orderItemId, rating, comment } = req.body;

    const review = await ReviewService.createReview(user.id, { orderItemId, rating, comment });

    sendSuccess(res, 201, 'Review submitted successfully', review);
});
