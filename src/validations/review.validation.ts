import { z } from "zod";

export const getProductReviewsSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, 'Invalid product id'),
    }),
    query: z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
});

export const createReviewSchema = z.object({
    body: z.object({
        orderItemId: z.string().regex(/^\d+$/, 'Invalid order item id'),
        rating: z.coerce.number().int().min(1, 'Rating must be at least 1 star').max(5, 'Rating must be at most 5 stars'),
        comment: z.string().trim().max(1000, 'Comment is too long').optional(),
    }),
});
