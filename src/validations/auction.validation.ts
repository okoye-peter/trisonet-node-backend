import { z } from "zod";

export const createAuctionSchema = z.object({
    body: z.object({
        gkwthAmount: z.coerce.number()
            .min(1, "GKWTH amount must be at least 1")
            .refine((v) => Math.round(v * 100) === v * 100, "GKWTH amount can have at most 2 decimal places"),
        startingBid: z.coerce.number().positive("Starting bid must be greater than 0"),
        buyItNowPrice: z.coerce.number().positive().optional(),
        minIncrement: z.coerce.number().positive().optional(),
        durationHours: z.coerce.number().positive("Duration is required"),
        visibility: z.enum(["public", "followers", "private"]).optional(),
    }),
});
export type CreateAuctionInput = z.infer<typeof createAuctionSchema>["body"];

export const placeBidSchema = z.object({
    body: z.object({
        amount: z.coerce.number().positive("Bid amount must be greater than 0"),
    }),
    params: z.object({
        id: z.coerce.string().min(1, "Auction id is required"),
    }),
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>["body"];

export const rejectBidSchema = z.object({
    params: z.object({
        id: z.coerce.string().min(1, "Auction id is required"),
        bidId: z.coerce.string().min(1, "Bid id is required"),
    }),
});

export const submitReviewSchema = z.object({
    body: z.object({
        rating: z.coerce.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
    }),
    params: z.object({
        id: z.coerce.string().min(1, "Auction id is required"),
    }),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>["body"];
