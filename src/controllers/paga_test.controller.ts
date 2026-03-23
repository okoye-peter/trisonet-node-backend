import { Request, Response, NextFunction } from "express";
import { PagaService } from "../services/paga.service";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";

export const testGenerateVirtualAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { amount, customerName, customerPhoneNumber, reference } = req.body;

    const pagaService = new PagaService();
    
    // Generate a reference if not provided
    const ref = reference || pagaService.generateReference('TEST_VR');

    const response = await pagaService.generateVirtualAccount(
        Number(amount),
        customerName,
        customerPhoneNumber,
        ref
    );

    if (!response.success) {
        return next(new AppError(response.error || 'Failed to generate virtual account', 400));
    }

    return sendSuccess(res, 200, 'Test virtual account generated successfully', response);
});
