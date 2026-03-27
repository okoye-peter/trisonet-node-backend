import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";
import { paginate } from "../utils/pagination";
import { NextFunction, Request, Response } from "express";
import { PaymentService } from "../services/payment.service";
import { LoanService } from "../services/loan.service";

export const generateVirtualAccountForWardSlotPurchase = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const result = await paymentService.generateVirtualAccountForWardSlotPurchase(BigInt(req.user.id), req.body.type, req.body.quantity, req.user);
    return sendSuccess(res, 200, 'Virtual account generated successfully', result);
});

export const purchaseGkwth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const result = await paymentService.generateVirtualAccountForGkwthPurchase(BigInt(req.user.id), req.body.quantity, req.user);
    return sendSuccess(res, 200, 'Virtual account generated successfully', result);
});

export const initiateDirectWalletFunding = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const result = await paymentService.initiateDirectWalletFunding(BigInt(req.user.id), req.body.amount, req.user);
    return sendSuccess(res, 200, 'Funding initiated', result);
});

export const initiateGkwthPurchase = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const result = await paymentService.initiateGkwthPurchase(BigInt(req.user.id), req.body.gkwthAmount, req.user);
    return sendSuccess(res, 200, 'Funding initiated', result);
});

export const checkFundingStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const reference = req.params.reference as string;
    
    // 1. Check if the funding record still exists in our DB
    const fundingRecord = await prisma.manuallyFunding.findFirst({
        where: { receipt: reference }
    });

    // 2. If record is gone, it might have been processed by webhook already
    if (!fundingRecord) {
        return sendSuccess(res, 200, 'Transaction status checked', { status: 'success' });
    }

    // 3. If record is still there, check Paga status directly
    // const pagaService = new PagaService();
    // const result = await pagaService.verifyPayment(reference);

    // if (result.success && result.is_paid) {
        // If Paga says it's paid but our webhook hasn't run yet, it's safer to just return 'success'
        // and let the frontend poll until the webhook credits it or show success and refresh.
    //     return sendSuccess(res, 200, 'Transaction status checked', { status: 'success' });
    // }

    return sendSuccess(res, 200, 'Transaction status checked', { status: 'pending' });
});

export const handlePagaWebhook = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const result = await paymentService.processPagaWebhook(req.body);
    return res.status(200).json(result);
});

export const requestAssetLoan = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const loanService = new LoanService();
    const loan = await loanService.createLoanRequest(req.user.id, req.body.quantity, req.user);
    sendSuccess(res, 201, 'Loan request was successful and is now under review', loan);
});

export const getAssetLoans = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { page, limit } = req.query;

    const loans = await paginate(
        prisma.loan,
        {
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' }
        },
        {
            page: Number(page) || 1,
            limit: Number(limit) || 10
        }
    );

    sendSuccess(res, 200, 'Asset loans fetched successfully', loans);
});
