import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import * as CategoryService from "../services/category.service";

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
    const categories = await CategoryService.listCategories();
    sendSuccess(res, 200, 'Categories fetched successfully', categories);
});
