import { asyncHandler } from "../middlewares/asyncHandler";
import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import EarningService from "../services/earning.service";

/**
 * Get paginated earning transactions for the auth user.
 */
export const getAuthUserEarningTransactions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user.id;
    const { page, limit, search, type } = req.query;

    const result = await EarningService.getEarningTransactions(userId, {
        page: page as string,
        limit: limit as string,
        search: search as string,
        type: type as string
    });

    sendSuccess(res, 200, 'Earning transactions fetched successfully', result);
});
