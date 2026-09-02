import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";
import { paginate } from "../utils/pagination";
import { NextFunction, Request, Response } from "express";
import { PaymentService } from "../services/payment.service";
import { LoanService } from "../services/loan.service";
import { PagaService } from "../services/paga.service";

export const generateVirtualAccountForWardSlotPurchase = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const result = await paymentService.generateVirtualAccountForWardSlotPurchase(BigInt(req.user.id), req.body.type, req.body.quantity, req.user);
    return sendSuccess(res, 200, 'Virtual account generated successfully', result);
});

export const verifyWardSlotPurchase = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { reference } = req.body;
    if (!reference) {
        throw new AppError('Reference is required', 400);
    }

    const user = req.user;
    const payment = await prisma.guardianWardSlotPurchase.findFirst({
        where: {
            reference,
            userId: user.id,
            status: 'success'
        }
    })
    if (!payment) {
        throw new AppError('Payment not found', 404);
    }

    if (payment.status === 'success') {
        return sendSuccess(res, 200, 'Payment verified successfully', payment);
    }

    throw new AppError('Payment not found', 404);
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
export const initiateActivationPayment = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const { teamMateIds } = req.body;
    const result = await paymentService.initiateActivationPayment(BigInt(req.user.id), teamMateIds || [], req.user);
    return sendSuccess(res, 200, 'Activation payment initiated', result);
});

export const generateActivationRequestVirtualAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const { amount, teamMateIds } = req.body;
    const result = await paymentService.generateActivationRequestVirtualAccount(BigInt(req.user.id), teamMateIds || [], Number(amount), req.user);
    return sendSuccess(res, 200, 'Virtual account generated', result);
});

export const activateByCode = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const { activation_code, teamMateIds } = req.body;
    const result = await paymentService.activateByCode(BigInt(req.user.id), activation_code, teamMateIds || []);
    return sendSuccess(res, 200, 'Account activated successfully', result);
});

export const checkActivationStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const reference = req.params.reference as string;
    const request = await prisma.userActivationRequest.findUnique({
        where: { reference }
    });

    if (!request) {
        throw new AppError('Activation request not found', 404);
    }

    return sendSuccess(res, 200, 'Activation status fetched', { status: request.status });
});

export const submitActivationProof = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { reference } = req.body;
    if (!req.file) {
        throw new AppError('No proof of payment uploaded', 400);
    }

    const request = await prisma.userActivationRequest.findUnique({
        where: { reference }
    });

    if (!request) {
        // Clean up uploaded file if request not found
        // (Optional: add utility to delete from cloudinary)
        throw new AppError('Activation request not found', 404);
    }

    const updatedRequest = await prisma.userActivationRequest.update({
        where: { id: request.id },
        data: {
            prove: req.file.path,
            cloudinaryPublicId: (req.file as any).filename // multer-storage-cloudinary uses filename for public_id
        }
    });

    return sendSuccess(res, 200, 'Proof of payment submitted successfully', updatedRequest);
});

export const generatePukVirtualAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const result = await paymentService.generatePukVirtualAccount(BigInt(req.user.id), req.user);
    return sendSuccess(res, 200, 'Virtual account generated successfully', result);
});

export const unblockWithPuk = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const paymentService = new PaymentService();
    const { puk } = req.body;
    if (!puk) {
        throw new AppError('PUK code is required', 400);
    }
    const result = await paymentService.unblockWithPuk(BigInt(req.user.id), puk);
    return sendSuccess(res, 200, 'Account unblocked successfully', result);
});

export const checkPukPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
    const paymentService = new PaymentService();
    const result = await paymentService.checkPukPaymentStatus(BigInt(req.user.id));
    return sendSuccess(res, 200, 'Payment status checked', result);
});

export const verifyPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
    const reference = req.params.reference as string;
    const pagaService = new PagaService();
    const result = await pagaService.verifyPayment(reference);

    if (!result.success) {
        throw new AppError((result as any).error ?? 'Payment verification failed', 400);
    }

    return sendSuccess(res, 200, 'Payment status fetched', result);
});

export const verifyCardCharge = asyncHandler(async (req: Request, res: Response) => {
    const { reference, amount, currency } = req.body;
    if (!reference || !amount) {
        throw new AppError('reference and amount are required', 400);
    }

    const pagaService = new PagaService();
    const result = await pagaService.verifyCardCharge(reference, Number(amount), currency ?? 'NGN');

    if (!result.success) {
        throw new AppError((result as any).error ?? 'Card payment verification failed', 400);
    }

    return sendSuccess(res, 200, 'Card payment status fetched', result);
});

