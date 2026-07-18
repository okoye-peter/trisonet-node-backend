import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";
import AuctionService from "../services/auction.service";

export const getAuctionSettings = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const settings = await AuctionService.getAuctionSettings();
    sendSuccess(res, 200, "Auction settings fetched successfully", settings);
});

export const createAuction = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const listing = await AuctionService.createListing(req.user, req.body);
        sendSuccess(res, 201, "Auction created successfully", listing);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const listAuctions = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { page, limit, status, search, sort } = req.query;
    const result = await AuctionService.listAuctions(req.user || null, {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        status: (status as string) || undefined,
        search: (search as string) || undefined,
        sort: (sort as string) || undefined,
    });
    sendSuccess(res, 200, "Auctions fetched successfully", result);
});

export const getMyAuctions = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const result = await AuctionService.getMyAuctions(req.user);
    sendSuccess(res, 200, "Your auctions fetched successfully", result);
});

export const getMyBidHistory = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { page, limit, result } = req.query;
    const data = await AuctionService.getMyBidHistory(req.user, {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        result: (result as string) || undefined,
    });
    sendSuccess(res, 200, "Your bid history fetched successfully", data);
});

export const getAuctionDetail = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const listing = await AuctionService.getListingDetail(req.user || null, BigInt(req.params.id));
        sendSuccess(res, 200, "Auction fetched successfully", listing);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const placeBid = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const bid = await AuctionService.placeBid(req.user, BigInt(req.params.id), req.body);
        sendSuccess(res, 201, "Bid placed successfully", bid);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const buyItNow = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const result = await AuctionService.buyItNow(req.user, BigInt(req.params.id));
        sendSuccess(res, 201, "Purchase successful", result);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const acceptBid = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const result = await AuctionService.acceptBid(req.user, BigInt(req.params.id), BigInt(req.params.bidId));
        sendSuccess(res, 200, "Bid accepted successfully", result);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const rejectBid = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const result = await AuctionService.rejectBid(req.user, BigInt(req.params.id), BigInt(req.params.bidId));
        sendSuccess(res, 200, "Bid rejected successfully", result);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const claimAuction = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const claim = await AuctionService.claimAuction(req.user, BigInt(req.params.id));
        sendSuccess(res, 200, "Claim created successfully", claim);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const endEarly = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const result = await AuctionService.endEarly(req.user, BigInt(req.params.id));
        sendSuccess(res, 200, "Auction ended", result);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const getAuctionTransaction = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const transaction = await AuctionService.getTransactionForListing(req.user, BigInt(req.params.id));
        sendSuccess(res, 200, "Transaction fetched successfully", transaction);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});

export const submitReview = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    try {
        const review = await AuctionService.submitReview(req.user, BigInt(req.params.id), req.body);
        sendSuccess(res, 201, "Review submitted successfully", review);
    } catch (error: any) {
        return next(error instanceof AppError ? error : new AppError(error.message, 400));
    }
});
