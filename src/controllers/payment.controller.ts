import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { PagaService } from "../services/paga.service";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";
import { paginate } from "../utils/pagination";
import { NextFunction, Request, Response } from "express";
import { addMinutes, format } from "date-fns";

export const generateVirtualAccountForWardSlotPurchase = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { type, quantity } = req.body;
    const { id: userId } = req.user;

    if (!['limited', 'unlimited'].includes(type)) {
        return sendSuccess(res, 400, 'Invalid purchase type');
    }

    if (type === 'limited' && (!quantity || quantity <= 0)) {
        return sendSuccess(res, 400, 'Invalid quantity for limited purchase');
    }

    const [unlimitedPriceVal, slotPriceVal, user] = await Promise.all([
        prisma.setting.findFirst({ where: { key: 'unlimited_parent_ward_slot' } }),
        prisma.setting.findFirst({ where: { key: 'ward_slot_purchase_price' } }),
        prisma.user.findFirst({ where: { id: userId } })
    ]);

    if (!unlimitedPriceVal || !slotPriceVal) {
        return sendSuccess(res, 400, 'Slot price settings not found');
    }

    const rawAmount = type === 'unlimited'
        ? Number(unlimitedPriceVal.value)
        : Number(slotPriceVal.value) * (quantity || 0);

    const pagaService = new PagaService();
    const totalWithCharge = rawAmount + pagaService.calculateCharge(rawAmount);

    const ref = pagaService.generateReference('WARDSLOT');

    const response = await pagaService.generateVirtualAccount(
        rawAmount,
        user?.name as string,
        user?.phone as string,
        ref
    );

    if (!response.success) {
        return sendSuccess(res, 400, response?.error || 'Failed to generate virtual account');
    }

    await prisma.guardianWardSlotPurchase.create({
        data: {
            userId,
            type: type as any,
            quantityPurchased: type === 'limited' ? quantity : null,
            price: rawAmount,
            charges: pagaService.calculateCharge(rawAmount),
            reference: ref,
            status: 'pending'
        }
    });

    return sendSuccess(res, 200, 'Virtual account generated successfully', {
        account_detail: {
            account_name: response.data.account_name,
            bank_name: response.data.bank_name,
            account_number: response.data.virtual_account,
            amount: totalWithCharge,
            expiry_date: format(addMinutes(new Date(), 28), 'HH:mm')
        }
    });
});

export const purchaseGkwth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { quantity } = req.body;
    const { id: userId } = req.user;

    if (!quantity || quantity < 0.5) {
        return sendSuccess(res, 400, 'Minimum purchase quantity is 0.5 GKWTH');
    }

    const [priceSetting, user, wallet] = await Promise.all([
        prisma.setting.findFirst({ where: { key: 'gkwth_sale_price' } }),
        prisma.user.findFirst({ where: { id: userId } }),
        prisma.wallet.findFirst({ where: { userId, type: 'indirect' } })
    ]);

    if (!priceSetting || !wallet) {
        return sendSuccess(res, 400, 'GKWTH price settings or wallet not found');
    }

    const price = Number(priceSetting.value);
    const rawAmount = quantity * price;

    const pagaService = new PagaService();
    const totalWithCharge = rawAmount + pagaService.calculateCharge(rawAmount);

    const ref = pagaService.generateReference('GK_PURCHASE');

    const response = await pagaService.generateVirtualAccount(
        rawAmount,
        user?.name as string,
        user?.phone as string,
        ref
    );

    if (!response.success) {
        return sendSuccess(res, 400, response?.error || 'Failed to generate virtual account');
    }

    // Use ManuallyFunding as a temporary storage for the Paga reference
    await prisma.manuallyFunding.create({
        data: {
            walletId: wallet.id,
            amount: rawAmount.toString(),
            gkwthValuePerUnit: price.toString(),
            gkwthAmountToSend: quantity.toString(),
            receipt: ref // Store Paga reference here
        }
    });

    return sendSuccess(res, 200, 'Virtual account generated successfully', {
        account_detail: {
            account_name: response.data.account_name,
            bank_name: response.data.bank_name,
            account_number: response.data.virtual_account,
            amount: totalWithCharge,
            expiry_date: format(addMinutes(new Date(), 28), 'HH:mm'),
            reference: ref
        }
    });
});

export const handlePagaWebhook = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // Note: In a real implementation, you'd verify the Paga hash here
    const { referenceNumber, transactionId, status } = req.body;

    if (status !== 'SUCCESS') {
        return res.status(200).json({ status: 'ok' }); // Acknowledge even if failed
    }

    // 1. Find the funding record
    const fundingRecord = await prisma.manuallyFunding.findFirst({
        where: { receipt: referenceNumber },
        include: { wallet: { include: { user: true } } }
    });

    if (!fundingRecord) {
        console.error(`Funding record not found for ref: ${referenceNumber}`);
        return res.status(200).json({ status: 'ok' });
    }

    const user = fundingRecord.wallet.user;
    const wallet = fundingRecord.wallet;
    const totalPurchasedGkwth = Number(fundingRecord.gkwthAmountToSend);
    const price = Number(fundingRecord.gkwthValuePerUnit);

    await prisma.$transaction(async (tx) => {
        // 2. Check for active loan
        const userLoans = await tx.loan.findMany({
            where: {
                userId: user.id,
                status: 'granted'
            },
            orderBy: { createdAt: 'desc' }
        });

        const activeLoan = userLoans.find(l => l.quantityGranted > l.quantityRepaid);

        if (activeLoan) {
            const loanAmountLeft = activeLoan.quantityGranted - activeLoan.quantityRepaid;

            if (totalPurchasedGkwth > loanAmountLeft) {
                // Repay loan fully and credit the rest
                const walletCredit = totalPurchasedGkwth - loanAmountLeft;

                await tx.loan.update({
                    where: { id: activeLoan.id },
                    data: { quantityRepaid: { increment: loanAmountLeft } }
                });

                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: { amount: { increment: walletCredit } }
                });

                await tx.user.update({
                    where: { id: user.id },
                    data: {
                        canWithdraw: true,
                        canOptOut: true,
                        canWithdrawGkwth: true
                    }
                });

                // Log repayment as a "withdrawal" log per PHP logic
                await tx.withDrawal.create({
                    data: {
                        userId: user.id,
                        amount: totalPurchasedGkwth.toString(),
                        bankName: 'purchase business asset used to repaid loan',
                        accountNumber: `wallet id = ${wallet.id} paga_ref = ${referenceNumber}`,
                        isPaid: 1, // status success
                        oldBalance: wallet.amount.toString(),
                        newBalance: walletCredit.toString(),
                        gkwthPrice: price
                    }
                });

                // Update central treasury
                await tx.wallet.updateMany({
                    where: { type: 'central_treasury' },
                    data: { amount: { increment: loanAmountLeft } }
                });

            } else {
                // Partial loan repayment
                await tx.loan.update({
                    where: { id: activeLoan.id },
                    data: { quantityRepaid: { increment: totalPurchasedGkwth } }
                });

                const updatedLoan = await tx.loan.findUnique({ where: { id: activeLoan.id } });

                await tx.withDrawal.create({
                    data: {
                        userId: user.id,
                        amount: totalPurchasedGkwth.toString(),
                        bankName: 'purchase business asset used to repaid loan',
                        accountNumber: `wallet id = ${wallet.id} paga_ref = ${referenceNumber}`,
                        isPaid: 1,
                        oldBalance: `loan amount repaid is ${updatedLoan?.quantityRepaid}`,
                        newBalance: `loan amount left is ${(updatedLoan?.quantityGranted || 0) - (updatedLoan?.quantityRepaid || 0)}`,
                        gkwthPrice: price
                    }
                });

                await tx.wallet.updateMany({
                    where: { type: 'central_treasury' },
                    data: { amount: { increment: totalPurchasedGkwth } }
                });
            }
        } else {
            // No loan, direct credit
            await tx.wallet.update({
                where: { id: wallet.id },
                data: { amount: { increment: totalPurchasedGkwth } }
            });

            await tx.withDrawal.create({
                data: {
                    userId: user.id,
                    amount: totalPurchasedGkwth.toString(),
                    bankName: 'purchase business asset',
                    accountNumber: `wallet id = ${wallet.id} paga_ref = ${referenceNumber}`,
                    isPaid: 1,
                    oldBalance: wallet.amount.toString(),
                    newBalance: (wallet.amount + totalPurchasedGkwth).toString(),
                    gkwthPrice: price
                }
            });

            await tx.wallet.updateMany({
                where: { type: 'central_treasury' },
                data: { amount: { decrement: totalPurchasedGkwth } }
            });
        }

        // Clean up funding record
        await tx.manuallyFunding.delete({ where: { id: fundingRecord.id } });
    });

    return res.status(200).json({ status: 'ok' });
});

export const requestAssetLoan = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;
    const { quantity } = req.body;

    if (!quantity || isNaN(Number(quantity))) {
        return next(new AppError('Please provide a valid quantity', 400));
    }

    // 1. Check Global Lock
    const lockSetting = await prisma.setting.findFirst({
        where: { key: 'lock_upfront_sale' }
    });

    if (lockSetting?.value === '1') {
        return next(new AppError('Upfront sale is currently not available', 400));
    }

    // 2. Fetch User Wallets
    const wallets = await prisma.wallet.findMany({
        where: { userId: user.id }
    });

    const indirectWallet = wallets.find(w => w.type === 'indirect');
    if (!indirectWallet) {
        return next(new AppError('Indirect wallet not found', 400));
    }

    // 3. Validate Quantity > Indirect Wallet Balance
    if (Number(quantity) <= indirectWallet.amount) {
        return next(new AppError(`Requested quantity must be greater than your current indirect wallet balance (${indirectWallet.amount})`, 400));
    }

    // 4. Check Central Treasury
    const treasury = await prisma.wallet.findFirst({
        where: { type: 'central_treasury' }
    });

    if (!treasury || treasury.amount < Number(quantity)) {
        return next(new AppError("The requested amount can't be granted currently, please request for something lower", 400));
    }

    // 5. Check Account Age (3 months)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    if (new Date(user.createdAt) > threeMonthsAgo) {
        return next(new AppError('Your account must be 3 months or older to be eligible', 400));
    }

    // 6. Check Referrals (at least 12)
    const activeReferralsCount = await prisma.user.count({
        where: {
            referralId: user.id,
            status: true
        }
    });

    if (activeReferralsCount < 12) {
        return next(new AppError('You must have at least 12 active direct referrals to be eligible', 400));
    }

    // 7. Check Outstanding Loans
    const userLoans = await prisma.loan.findMany({
        where: {
            userId: user.id,
            status: 'granted'
        }
    });

    const isOwing = userLoans.some(l => l.quantityGranted > l.quantityRepaid);

    if (isOwing) {
        return next(new AppError("You can't request a new loan without paying up outstanding loans", 400));
    }

    // 8. Check Bank Details
    if (!user.bank || !user.accountNumber) {
        return next(new AppError('Please update your bank details in your profile first', 400));
    }

    // 9. Create Loan Request
    const loan = await prisma.loan.create({
        data: {
            userId: user.id,
            walletId: indirectWallet.id,
            quantityRequested: Number(quantity),
            status: 'pending'
        }
    });

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
