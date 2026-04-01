import { prisma, Prisma } from "../config/prisma";
import { pagaLogger } from "../utils/logger";
import { AppError } from "../utils/AppError";
import { PagaService } from "./paga.service";
import { addMinutes, format } from "date-fns";
import { GuardianSlotType } from "../generated/prisma/index.js";

export class PaymentService {
    /**
     * Process Paga webhook payload
     */
    async processPagaWebhook(payload: any) {
        const { externalReferenceNumber, event, status, paymentAmount } = payload;

        if (!['PAYMENT_COMPLETE', 'PARTIAL_PAYMENT'].includes(event)) {
            pagaLogger.error(`Paga webhook received for ref: ${externalReferenceNumber} with event: ${event} and status: ${status}. data: ${JSON.stringify(payload)}`);
            return { status: 'skipped' };
        }

        // 1. Find the funding record
        const fundingRecord = await prisma.manuallyFunding.findFirst({
            where: { receipt: externalReferenceNumber },
            include: { wallet: { include: { user: true } } }
        });

        if (!fundingRecord) {
            console.error(`Funding record not found for ref: ${externalReferenceNumber}`);
            return { status: 'not_found' };
        }

        const user = fundingRecord.wallet.user;
        const wallet = fundingRecord.wallet;

        if (!wallet) {
            pagaLogger.error(`Wallet not found for funding record: ${fundingRecord.id}. data: ${JSON.stringify(payload)}`);
            return { status: 'wallet_not_found' };
        }

        // Check if the paid amount matches or exceeds the expected amount
        if (paymentAmount && Number(fundingRecord.amount) > Number(paymentAmount)) {
            pagaLogger.error(`Paga failed transaction due to wallet amount mismatch. Expected: ${fundingRecord.amount}, Paid: ${paymentAmount}. data: ${JSON.stringify(payload)}`);
            return { status: 'amount_mismatch' };
        }
        
        // Check if it's a direct wallet funding or a GKWTH purchase
        const isDirectFunding = externalReferenceNumber.startsWith('DIRECT_WALLET') || 
                                externalReferenceNumber.startsWith('DIRECTWALLET') || 
                                externalReferenceNumber.startsWith('WALLET');

        if (isDirectFunding) {
            return await this.processDirectFunding(fundingRecord, wallet, user);
        }

        return await this.processGkwthPurchase(fundingRecord, wallet, user, externalReferenceNumber);
    }

    private async processDirectFunding(fundingRecord: any, wallet: any, user: any) {
        const amount = Number(fundingRecord.amount);
        
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Credit the wallet
            await tx.wallet.update({
                where: { id: wallet.id },
                data: { amount: { increment: amount } }
            });

            // Notify user
            const type_str = wallet.type === 'indirect' ? 'gkwth wallet' : 'wallet';
            const amount_str = wallet.type === 'indirect' ? `${fundingRecord.amount} gkwth` : `₦${fundingRecord.amount}`;

            const notification = await tx.notification.create({
                data: {
                    title: 'wallet funding transaction status',
                    body: `Your ${type_str} has been credited with ${amount_str}`,
                }
            });

            await tx.notificationUser.create({
                data: {
                    userId: user.id,
                    notificationId: notification.id,
                }
            });

            // Clean up funding record
            await tx.manuallyFunding.delete({ where: { id: fundingRecord.id } });
        });
        
        return { status: 'ok' };
    }

    private async processGkwthPurchase(fundingRecord: any, wallet: any, user: any, externalReferenceNumber: string) {
        const totalPurchasedGkwth = Number(fundingRecord.gkwthAmountToSend);
        const price = Number(fundingRecord.gkwthValuePerUnit);

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // 2. Check for active loan
            const userLoans = await tx.loan.findMany({
                where: {
                    userId: user.id,
                    status: 'granted'
                },
                orderBy: { createdAt: 'desc' }
            });

            const activeLoan = userLoans.find((l: any) => l.quantityGranted > l.quantityRepaid);

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

                    // Log repayment
                    await tx.withDrawal.create({
                        data: {
                            userId: user.id,
                            amount: totalPurchasedGkwth.toString(),
                            bankName: 'purchase business asset used to repaid loan',
                            accountNumber: `wallet id = ${wallet.id} paga_ref = ${externalReferenceNumber}`,
                            isPaid: 1,
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
                            accountNumber: `wallet id = ${wallet.id} paga_ref = ${externalReferenceNumber}`,
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
                        accountNumber: `wallet id = ${wallet.id} paga_ref = ${externalReferenceNumber}`,
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

        return { status: 'ok' };
    }

    /**
     * Initiate GKWTH purchase
     */
    async initiateGkwthPurchase(userId: bigint, gkwthAmount: number, user: any) {
        const [lockSetting, wallet, priceSetting] = await Promise.all([
            prisma.setting.findFirst({ where: { key: 'lock_wallet_funding' } }),
            prisma.wallet.findFirst({ 
                where: { userId: userId, type: 'indirect' }, 
            }),
            prisma.setting.findFirst({ where: { key: 'gkwth_sale_price' } })
        ]);

        if (lockSetting?.value === '1') {
            throw new AppError('Wallet funding is currently unavailable', 400);
        }

        if (!priceSetting) {
            throw new AppError('GKWTH price not set', 400);
        }

        if (!wallet) {
            throw new AppError('Indirect wallet not found', 400);
        }

        const pagaService = new PagaService();
        const ref = pagaService.generateReference('GK_PURCHASE');

        const response = await pagaService.generateVirtualAccount(
            Number(gkwthAmount) * Number(priceSetting?.value),
            user?.name as string,
            user?.phone as string,
            ref
        );

        if (!response.success) {
            throw new AppError(response.error || 'Failed to generate virtual account', 400);
        }

        // Create a pending funding record
        await prisma.manuallyFunding.create({
            data: {
                walletId: wallet.id,
                amount: (Number(gkwthAmount) * Number(priceSetting?.value)).toString(),
                gkwthValuePerUnit: priceSetting?.value || '0',
                gkwthAmountToSend: gkwthAmount.toString(),
                receipt: ref,
            }
        });

        return {
            reference: ref,
            amount: response.data.amount,
            account_detail: {
                account_name: response.data.account_name,
                bank_name: response.data.bank_name,
                account_number: response.data.virtual_account,
                expiry_date: response.data.expiry_date_full ? format(new Date(response.data.expiry_date_full), 'HH:mm') : format(addMinutes(new Date(), 28), 'HH:mm'),
            }
        };
    }

    /**
     * Initiate direct wallet funding
     */
    async initiateDirectWalletFunding(userId: bigint, amount: number, user: any) {
        const lockSetting = await prisma.setting.findFirst({
            where: { key: 'lock_wallet_funding' }
        });

        if (lockSetting?.value === '1') {
            throw new AppError('Wallet funding is currently unavailable', 400);
        }

        const wallet = await prisma.wallet.findFirst({
            where: { userId: userId, type: 'direct' }
        });

        if (!wallet) {
            throw new AppError('Direct wallet not found', 400);
        }

        const pagaService = new PagaService();
        const ref = pagaService.generateReference('DIRECT_WALLET');

        const response = await pagaService.generateVirtualAccount(
            Number(amount),
            user.name,
            user.phone,
            ref
        );

        if (!response.success) {
            throw new AppError(response.error || 'Failed to generate virtual account', 400);
        }

        // Create a pending funding record
        await prisma.manuallyFunding.create({
            data: {
                walletId: wallet.id,
                amount: amount.toString(),
                receipt: ref,
            }
        });

        return {
            reference: ref,
            amount: response.data.amount,
            account_detail: {
                account_name: response.data.account_name,
                bank_name: response.data.bank_name,
                account_number: response.data.virtual_account,
                expiry_date: response.data.expiry_date_full ? format(new Date(response.data.expiry_date_full), 'HH:mm') : format(addMinutes(new Date(), 28), 'HH:mm'),
            }
        };
    }

    /**
     * Internal GKWTH purchase using direct wallet balance
     */
    async purchaseGkwth(userId: bigint, quantity: number, user: any) {
        const [lockSetting, indirectWallet, directWallet, priceSetting] = await Promise.all([
            prisma.setting.findFirst({ where: { key: 'lock_wallet_funding' } }),
            prisma.wallet.findFirst({ where: { userId: userId, type: 'indirect' } }),
            prisma.wallet.findFirst({ where: { userId: userId, type: 'direct' } }),
            prisma.setting.findFirst({ where: { key: 'gkwth_sale_price' } })
        ]);

        if (lockSetting?.value === '1') {
            throw new AppError('GKWTH purchase is currently unavailable', 400);
        }

        if (!priceSetting) {
            throw new AppError('GKWTH price not set', 400);
        }

        if (!indirectWallet || !directWallet) {
            throw new AppError('Wallet not found', 400);
        }

        const totalPrice = Number(quantity) * Number(priceSetting.value);

        if (directWallet.amount < totalPrice) {
            throw new AppError('Insufficient balance in direct wallet', 400);
        }

        // Use transaction to ensure consistency
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Deduct from direct wallet
            await tx.wallet.update({
                where: { id: directWallet.id },
                data: { amount: { decrement: totalPrice } }
            });

            // Credit to indirect wallet
            await tx.wallet.update({
                where: { id: indirectWallet.id },
                data: { amount: { increment: Number(quantity) } }
            });

            // Add to withdrawal log for tracking
            await tx.withDrawal.create({
                data: {
                    userId: userId,
                    amount: quantity.toString(),
                    bankName: 'internal gkwth purchase',
                    accountNumber: `direct_wallet_id: ${directWallet.id}`,
                    isPaid: 1,
                    oldBalance: indirectWallet.amount.toString(),
                    newBalance: (indirectWallet.amount + Number(quantity)).toString(),
                    gkwthPrice: Number(priceSetting.value)
                }
            });
        });

        return { status: 'success' };
    }

    /**
     * Generate virtual account for ward slot purchase
     */
    async generateVirtualAccountForWardSlotPurchase(userId: bigint, type: string, quantity: number, user: any) {
        if (!['limited', 'unlimited'].includes(type)) {
            throw new AppError('Invalid purchase type', 400);
        }

        if (type === 'limited' && (!quantity || quantity <= 0)) {
            throw new AppError('Invalid quantity for limited purchase', 400);
        }

        const [unlimitedPriceVal, slotPriceVal, lockSetting] = await Promise.all([
            prisma.setting.findFirst({ where: { key: 'unlimited_parent_ward_slot' } }),
            prisma.setting.findFirst({ where: { key: 'ward_slot_purchase_price' } }),
            prisma.setting.findFirst({ where: { key: 'lock_ward_slot_purchase' } })
        ]);

        if (lockSetting?.value === '1') {
            throw new AppError('Ward slot purchase is currently unavailable', 400);
        }

        if (!unlimitedPriceVal || !slotPriceVal) {
            throw new AppError('Slot price settings not found', 400);
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
            throw new AppError(response?.error || 'Failed to generate virtual account', 400);
        }

        await prisma.guardianWardSlotPurchase.create({
            data: {
                userId,
                type: type as GuardianSlotType,
                quantityPurchased: type === 'limited' ? quantity : null,
                price: rawAmount,
                charges: pagaService.calculateCharge(rawAmount),
                reference: ref,
                status: 'pending'
            }
        });

        return {
            account_detail: {
                account_name: response.data.account_name,
                bank_name: response.data.bank_name,
                account_number: response.data.virtual_account,
                amount: totalWithCharge,
                expiry_date: response.data.expiry_date_full ? format(new Date(response.data.expiry_date_full), 'HH:mm') : format(addMinutes(new Date(), 28), 'HH:mm')
            }
        };
    }

    /**
     * Generate virtual account for GKWTH purchase
     */
    async generateVirtualAccountForGkwthPurchase(userId: bigint, quantity: number, user: any) {
        if (!quantity || quantity < 0.5) {
            throw new AppError('Minimum purchase quantity is 0.5 GKWTH', 400);
        }

        const [priceSetting, wallet] = await Promise.all([
            prisma.setting.findFirst({ where: { key: 'gkwth_sale_price' } }),
            prisma.wallet.findFirst({ where: { userId, type: 'indirect' } })
        ]);

        if (!priceSetting || !wallet) {
            throw new AppError('GKWTH price settings or wallet not found', 400);
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
            throw new AppError(response?.error || 'Failed to generate virtual account', 400);
        }

        // Use ManuallyFunding as a temporary storage for the Paga reference
        await prisma.manuallyFunding.create({
            data: {
                walletId: wallet.id,
                amount: rawAmount.toString(),
                gkwthValuePerUnit: price.toString(),
                gkwthAmountToSend: quantity.toString(),
                receipt: ref
            }
        });

        return {
            account_detail: {
                account_name: response.data.account_name,
                bank_name: response.data.bank_name,
                account_number: response.data.virtual_account,
                amount: totalWithCharge,
                expiry_date: response.data.expiry_date_full ? format(new Date(response.data.expiry_date_full), 'HH:mm') : format(addMinutes(new Date(), 28), 'HH:mm'),
                reference: ref
            }
        };
    }
}
