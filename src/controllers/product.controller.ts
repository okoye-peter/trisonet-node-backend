import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import * as ProductService from "../services/product.service";
import * as ReviewService from "../services/review.service";

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, search, categoryId } = req.query;

    const result = await ProductService.listProducts({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        search: search as string | undefined,
        categoryId: categoryId as string | undefined,
    });

    sendSuccess(res, 200, 'Products fetched successfully', result);
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
    const product = await ProductService.getProductById(req.params.id as string);
    sendSuccess(res, 200, 'Product fetched successfully', product);
});

export const getProductReviews = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit } = req.query;

    const result = await ReviewService.getProductReviews(
        req.params.id as string,
        page ? Number(page) : undefined,
        limit ? Number(limit) : undefined,
    );

    sendSuccess(res, 200, 'Reviews fetched successfully', result);
});
