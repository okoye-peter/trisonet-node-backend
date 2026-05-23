import { prisma, Prisma, GuardianSlotType, User } from "../config/prisma.js";
import { pagaLogger } from "../utils/logger.js";
import { AppError } from "../utils/AppError.js";
import { PagaService } from "./paga.service.js";
import { addMinutes, format } from "date-fns";
import { AccountActivationService } from './account_activation.service.js';
import { ROLES, PAGA, ACTIVATION_CARD_STATUSES } from "../config/constants.js";
import { TermiiService } from './termii.service.js';


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

        if (externalReferenceNumber.startsWith('PG_FUND')) {
            return await this.processPatronGroupFunding(payload);
        }

        if (externalReferenceNumber.startsWith('ACTIVATION') && !externalReferenceNumber.startsWith('ACTIVATIONCARD')) {
            return await this.processUserActivation(payload);
        }

        if (externalReferenceNumber.startsWith('PUK')) {
            return await this.processPukUnblocking(payload);
        }

        if (externalReferenceNumber.startsWith('WARDSLOT')) {
            return await this.processWardSlotPurchase(payload);
        }

        if (externalReferenceNumber.startsWith('ACTIVATIONCARD')) {
            return await this.processActivationCardPurchase(payload);
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

    private async processPatronGroupFunding(payload: any) {
        const { externalReferenceNumber, paymentAmount } = payload;
        
        const fundingRecord = await prisma.patronGroupTransaction.findFirst({
            where: { reference: externalReferenceNumber, type: 'credit' },
            include: { patronGroup: true }
        });

        if (!fundingRecord) {
            pagaLogger.error(`Patron Group Funding transaction not found for ref: ${externalReferenceNumber}`);
            return { status: 'not_found' };
        }

        if (paymentAmount && Number(fundingRecord.amount) > Number(paymentAmount)) {
            pagaLogger.error(`Paga failed PG transaction due to amount mismatch. Expected: ${fundingRecord.amount}, Paid: ${paymentAmount}.`);
            return { status: 'amount_mismatch' };
        }

        if (fundingRecord.status === 'success') {
            return { status: 'already_processed' };
        }

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // 1. Update transaction status
            await tx.patronGroupTransaction.update({
                where: { id: fundingRecord.id },
                data: { status: 'success' }
            });
            
            // 2. Mark the group as funded
            // Note: Dashboard logic depends on a successful credit transaction existing
            
            pagaLogger.info(`Patron Group Funding successful for group: ${fundingRecord.patronGroupId}, amount: ${paymentAmount}`);
        });

        return { status: 'ok' };
    }

    async processUserActivation(payload: any) {
        const { externalReferenceNumber, paymentAmount } = payload;

        const activationRequest = await prisma.userActivationRequest.findUnique({
            where: { reference: externalReferenceNumber },
            include: { 
                user: true,
                activationTeamMates: {
                    include: {
                        user: true
                    }
                }
            }
        });

        if (!activationRequest) {
            pagaLogger.error(`User Activation Request not found for ref: ${externalReferenceNumber}`);
            return { status: 'not_found' };
        }

        if (paymentAmount && Number(activationRequest.amount) > Number(paymentAmount)) {
            pagaLogger.error(`Paga failed activation due to amount mismatch. Expected: ${activationRequest.amount}, Paid: ${paymentAmount}.`);
            return { status: 'amount_mismatch' };
        }

        if (activationRequest.status === 'approved') {
            return { status: 'already_processed' };
        }

        const teammateUserIds: bigint[] = [];
        if (activationRequest.activationTeamMates && activationRequest.activationTeamMates.length > 0) {
            for (const teammateRelation of activationRequest.activationTeamMates) {
                teammateUserIds.push(teammateRelation.userId);
            }
        }
        const recipientIds = Array.from(new Set([activationRequest.userId, ...teammateUserIds]));

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Update request status
            await tx.userActivationRequest.update({
                where: { id: activationRequest.id },
                data: { 
                    status: 'approved',
                    confirmedAt: new Date()
                }
            });

            // Activate primary user
            await tx.user.update({
                where: { id: activationRequest.userId },
                data: { accountState: 1 }
            });

            // Activate team members
            for (const mateId of teammateUserIds) {
                await tx.user.update({
                    where: { id: mateId },
                    data: { accountState: 1 }
                });
            }

            // Create notification
            const notification = await tx.notification.create({
                data: {
                    title: 'Activation Request',
                    body: 'Hello, this is to inform you that your application for activation of account has been approved',
                }
            });

            // Attach notification to primary user + teammates
            for (const recipientId of recipientIds) {
                await tx.notificationUser.create({
                    data: {
                        userId: recipientId,
                        notificationId: notification.id
                    }
                });
            }

            pagaLogger.info(`User Activation database records updated for user: ${activationRequest.userId}, teammates count: ${teammateUserIds.length}, reference: ${externalReferenceNumber}`);
        });

        // Run sequential optimized activations outside the transaction to prevent database lock competition deadlocks
        for (const recipientId of recipientIds) {
            await AccountActivationService.activateUserAccountOptimized(recipientId);
        }

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
     * Initiate patronage wallet funding
     */
    async initiatePatronageWalletFunding(userId: bigint, amount: number, user: any) {
        const wallet = await prisma.wallet.findFirst({
            where: { userId: userId, type: 'patronage' }
        });

        if (!wallet) {
            throw new AppError('Patronage wallet not found', 400);
        }

        const pagaService = new PagaService();
        const ref = pagaService.generateReference('WALLET');

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

        // Restriction: Patrons cannot fund their direct wallet
        if (user.role === ROLES.PATRON) {
            throw new AppError('Patrons are restricted from manually funding their direct wallet. Please fund your patronage wallet or organization balance instead.', 400);
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
            reference: ref,
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

    /**
     * Initiate activation payment (Card/SDK)
     */
    async initiateActivationPayment(userId: bigint, teamMateIds: string[], user: User) {
        const pagaService = new PagaService();
        
        // 1. Calculate price
        const [priceSetting, chargeSetting, infantFeeSetting] = await Promise.all([
            prisma.setting.findFirst({ where: { key: 'gkwth_sale_price' } }),
            prisma.setting.findFirst({ where: { key: 'paga_charges' } }),
            prisma.setting.findFirst({ where: { key: 'infant_form_fee' } })
        ]);

        const isDevUser = user.username === 'dev_user' || user.username === 'tes_commission';

        const activationPrice = Number(priceSetting?.value || 0);
        const activationCharge = Number(chargeSetting?.value || 0.008062); // Fallback to PAGA charge rate
        const infantFormFee = Number(infantFeeSetting?.value || 30000);

        // Current user cost
        const userBase = activationPrice + (user.isInfant && !user.sponsorId ? infantFormFee : 0);

        // Team mates cost
        let teamMatesBase = 0;
        if (teamMateIds.length > 0) {
            const teamMates = await prisma.user.findMany({
                where: { id: { in: teamMateIds.map(id => BigInt(id)) } }
            });

            for (const mate of teamMates) {
                teamMatesBase += activationPrice + (mate.isInfant && !mate.sponsorId ? infantFormFee : 0);
            }
        }

        const totalBase = isDevUser ? 100 : (userBase + teamMatesBase);
        // Formula matching legacy: price * (1 + charge * (1 + vat))
        // Here we simplify as base * (1 + charge_with_vat) where charge_with_vat = charge * 1.075
        const totalWithCharge = isDevUser ? 100.87 : totalBase * (1 + activationCharge * 1.075);

        const ref = pagaService.generateReference('ACTIVATION');

        // 2. Create activation request
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const request = await tx.userActivationRequest.create({
                data: {
                    userId,
                    amount: totalWithCharge.toFixed(2),
                    charge: Math.round(totalWithCharge - totalBase),
                    status: 'pending',
                    reference: ref
                }
            });

            if (teamMateIds.length > 0) {
                await tx.activationTeamMateUser.createMany({
                    data: teamMateIds.map(mateId => ({
                        userActivationRequestId: request.id,
                        userId: BigInt(mateId)
                    }))
                });
            }
        });

        return {
            reference: ref,
            amount: totalWithCharge,
            publicKey: PAGA.USERNAME,
            email: user.email,
            phoneNumber: user.phone || ''
        };
    }

    /**
     * Generate virtual account for activation request (Transfer)
     */
    async generateActivationRequestVirtualAccount(userId: bigint, teamMateIds: string[], inputAmount: number, user: User) {
        if (user.status) {
            throw new AppError('Your account is already activated', 400);
        }

        const pagaService = new PagaService();
        
        // 1. Calculate price
        const [priceSetting, chargeSetting, infantFeeSetting] = await Promise.all([
            prisma.setting.findFirst({ where: { key: 'gkwth_sale_price' } }),
            prisma.setting.findFirst({ where: { key: 'paga_charges' } }),
            prisma.setting.findFirst({ where: { key: 'infant_form_fee' } })
        ]);

        const activationPrice = Number(priceSetting?.value || 0);
        const activationCharge = Number(chargeSetting?.value || 0.008062);
        const infantFormFee = Number(infantFeeSetting?.value || 30000);

        if (!activationPrice) {
            throw new AppError('Configuration error: price not set', 500);
        }

        const isDevUser = user.username === 'dev_user' || user.username === 'tes_commission';

        // Current user cost
        const userBase = isDevUser ? 100 : activationPrice;
        const userTotal = userBase + (user.isInfant && !user.sponsorId ? infantFormFee : 0);

        // Team mates cost
        let teamMatesTotal = 0;
        if (teamMateIds.length > 0) {
            const teamMates = await prisma.user.findMany({
                where: { id: { in: teamMateIds.map(id => BigInt(id)) } }
            });

            for (const mate of teamMates) {
                teamMatesTotal += activationPrice + (mate.isInfant && !mate.sponsorId ? infantFormFee : 0);
            }
        }

        const total = isDevUser ? 100 : (userTotal + teamMatesTotal);
        const charge = isDevUser ? 0.87 : pagaService.calculateCharge(total);
        const totalWithCharge = isDevUser ? 100.87 : Math.round((total + charge) * 100) / 100;

        // Validate amount (only for non-dev users)
        if (user.username !== 'dev_user' && user.username !== 'tes_commission' && Number(inputAmount) !== totalWithCharge) {
            throw new AppError(`Inaccurate amount inputted. Expected: ${totalWithCharge}`, 400);
        }

        const ref = pagaService.generateReference('ACTIVATION');

        // 2. Generate virtual account
        const names = (user.name || '').trim().split(' ');
        const firstName = names[0] || 'User';
        const lastName = names[1] || firstName;

        // Pass base `total` (without charges) — Paga adds its own fee on top via
        // payerCollectionFeeShare:1, so the user ends up paying ≈ totalWithCharge.
        // Passing totalWithCharge here would cause Paga to add fees on top of an
        // already-charged amount, making the required payment higher than what the
        // frontend shows the user → underpayment → Paga reverses the transfer.
        const response = await pagaService.generateVirtualAccount(
            total,
            `${firstName} ${lastName}`,
            user.phone || '',
            ref
        );


        if (!response.success) {
            throw new AppError(response.error || 'Failed to generate virtual account', 400);
        }

        // 3. Create or update activation request
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Clean up old pending requests
            await tx.userActivationRequest.deleteMany({
                where: {
                    userId,
                    status: 'pending',
                    reference: { not: ref }
                }
            });

            const request = await tx.userActivationRequest.create({
                data: {
                    userId,
                    amount: totalWithCharge.toFixed(2),
                    charge: Math.round(charge),
                    status: 'pending',
                    reference: ref,
                    bankName: response.data.bank_name,
                    accountName: response.data.account_name,
                    bankAccount: response.data.virtual_account
                }
            });

            if (teamMateIds.length > 0) {
                await tx.activationTeamMateUser.createMany({
                    data: teamMateIds.map(mateId => ({
                        userActivationRequestId: request.id,
                        userId: BigInt(mateId)
                    }))
                });
            }
        });

        return {
            status: true,
            account_detail: {
                account_name: response.data.account_name,
                bank_name: response.data.bank_name,
                account_number: response.data.virtual_account,
                bank_code: null,
                expires_at: response.data.expiry_date_full ? format(new Date(response.data.expiry_date_full), 'HH:mm') : format(addMinutes(new Date(), 28), 'HH:mm'),
                amount: totalWithCharge,
                reference: ref,
                response: response
            }
        };
    }

    async activateByCode(userId: bigint, code: string, teamMateIds: string[]) {
        const card = await prisma.activationCard.findUnique({
            where: { code },
            include: { _count: { select: { usersWithCard: true } } }
        });

        if (!card) {
            throw new AppError('Invalid activation code', 400);
        }

        if (card.status !== 1) {
            throw new AppError('Activation code is not active or has not been approved', 400);
        }

        const maxUses = Math.round(card.amount / card.pricePerUser);
        const usedCount = card._count.usersWithCard;
        const requiredUses = 1 + teamMateIds.length;

        if (usedCount + requiredUses > maxUses) {
            throw new AppError(`This activation code only has ${maxUses - usedCount} uses left. You requested ${requiredUses}.`, 400);
        }

        const userIdsToActivate = [userId, ...teamMateIds.map(id => BigInt(id))];

        // 1. Assign activation card reference within the transaction (very fast, short locks)
        await prisma.$transaction(async (tx) => {
            for (const id of userIdsToActivate) {
                await tx.user.update({
                    where: { id },
                    data: { activationCardId: card.id }
                });
            }
        });

        // 2. Perform actual account activations outside the transaction to prevent lock competition deadlocks
        for (const id of userIdsToActivate) {
            await AccountActivationService.activateUserAccountOptimized(id);
        }

        return {
            status: true,
            message: 'Accounts activated successfully using PIM card'
        };
    }

    private async processPukUnblocking(payload: any) {
        const { externalReferenceNumber, paymentAmount } = payload;

        const unblockingPayment = await prisma.unblockingPayment.findFirst({
            where: { reference: externalReferenceNumber },
            include: { user: { include: { guardianUser: true } } }
        });

        if (!unblockingPayment) {
            pagaLogger.error(`PUK Unblocking payment not found for ref: ${externalReferenceNumber}`);
            return { status: 'not_found' };
        }

        if (paymentAmount && Number(unblockingPayment.amount) > Number(paymentAmount)) {
            pagaLogger.error(`PUK unblocking amount mismatch. Expected: ${unblockingPayment.amount}, Paid: ${paymentAmount}`);
            return { status: 'amount_mismatch' };
        }

        if (unblockingPayment.status) {
            return { status: 'already_processed' };
        }

        const user = unblockingPayment.user;
        const phone = user.phone || user.guardianUser?.phone;

        if (!phone) {
            pagaLogger.error(`User ${user.id} does not have a valid phone number to receive PUK code`);
            return { status: 'missing_phone' };
        }

        // Generate unique 10-digit random code
        const code = Math.floor(1000000000 + Math.random() * 9000000000).toString();

        await prisma.$transaction(async (tx) => {
            // Update unblocking payment status
            await tx.unblockingPayment.update({
                where: { id: unblockingPayment.id },
                data: { status: true }
            });

            // Set unblocking code on user
            await tx.user.update({
                where: { id: user.id },
                data: { unblockingCode: code }
            });
        });

        // Send SMS/Email notifications
        const nameCapitalized = user.name ? user.name.charAt(0).toUpperCase() + user.name.slice(1) : 'User';
        const isWard = !user.phone && user.guardianUser;
        const message = `Hello ${nameCapitalized} this is your ${isWard ? "ward's " + nameCapitalized + " PIM" : "PIM"} activation puk code: ${code}`;

        try {
            await TermiiService.sendSms(phone, message);
        } catch (smsError) {
            pagaLogger.error(`Failed to send PUK SMS to ${phone}:`, smsError);
        }

        if (user.email) {
            try {
                await TermiiService.sendMailWithTermii(user.email, code);
            } catch (mailError) {
                pagaLogger.error(`Failed to send PUK email to ${user.email}:`, mailError);
            }
        }

        pagaLogger.info(`PUK unblocking payment approved and code sent for user: ${user.id}, reference: ${externalReferenceNumber}`);
        return { status: 'ok' };
    }

    private async processWardSlotPurchase(payload: any) {
        const { externalReferenceNumber, paymentAmount } = payload;

        const slotPurchase = await prisma.guardianWardSlotPurchase.findUnique({
            where: { reference: externalReferenceNumber }
        });

        if (!slotPurchase) {
            pagaLogger.error(`Ward slot purchase record not found for ref: ${externalReferenceNumber}`);
            return { status: 'not_found' };
        }

        const totalExpected = slotPurchase.price + (slotPurchase.charges || 0);

        if (paymentAmount && Number(totalExpected) > Number(paymentAmount)) {
            pagaLogger.error(`Ward slot purchase amount mismatch. Expected: ${totalExpected}, Paid: ${paymentAmount}`);
            return { status: 'amount_mismatch' };
        }

        if (slotPurchase.status === 'success') {
            return { status: 'already_processed' };
        }

        await prisma.guardianWardSlotPurchase.update({
            where: { id: slotPurchase.id },
            data: { status: 'success' }
        });

        pagaLogger.info(`Ward slot purchase successful for user: ${slotPurchase.userId}, reference: ${externalReferenceNumber}`);
        return { status: 'ok' };
    }

    async processActivationCardPurchase(payload: any) {
        const { externalReferenceNumber, paymentAmount } = payload;

        const card = await prisma.activationCard.findFirst({
            where: { 
                proofOfPayment: externalReferenceNumber,
                status: ACTIVATION_CARD_STATUSES.PENDING
            }
        });

        if (!card) {
            pagaLogger.error(`Activation card request not found for ref: ${externalReferenceNumber}`);
            return { status: 'not_found' };
        }

        if (paymentAmount && Number(card.amount) > Number(paymentAmount)) {
            pagaLogger.error(`Activation card amount mismatch. Expected: ${card.amount}, Paid: ${paymentAmount}`);
            return { status: 'amount_mismatch' };
        }

        // Generate a random unique 10-character code
        let code = '';
        let isUnique = false;
        while (!isUnique) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            for (let i = 0; i < 10; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            code = result;

            const existing = await prisma.activationCard.findUnique({
                where: { code }
            });
            if (!existing) {
                isUnique = true;
            }
        }

        // Find the super admin's user ID
        const superAdmin = await prisma.user.findFirst({
            where: { role: ROLES.SUPER_ADMIN }
        });

        await prisma.activationCard.update({
            where: { id: card.id },
            data: {
                code,
                approvedBy: superAdmin?.id ?? null,
                status: ACTIVATION_CARD_STATUSES.APPROVED
            }
        });

        pagaLogger.info(`Activation card purchase approved for user: ${card.userId}, card ID: ${card.id}, code: ${code}`);
        return { status: 'ok' };
    }

    async processOnePipeWebhook(payload: any) {
        const details = payload?.details;
        const meta = details?.meta;
        const reference = meta?.payment_id;
        const amount = Number(details?.amount || 0) / 100;
        const status = details?.status?.toLowerCase() === 'successful';

        if (!status) {
            pagaLogger.info(`OnePipe webhook: transaction was not successful. Status: ${details?.status}`);
            return { status: 'skipped' };
        }

        if (!reference) {
            pagaLogger.error('OnePipe webhook missing payment_id in meta');
            return { status: 'missing_reference' };
        }

        const fullReference = 'ACTIVATION' + reference;

        const activationRequest = await prisma.userActivationRequest.findUnique({
            where: { reference: fullReference }
        });

        if (!activationRequest) {
            pagaLogger.error(`OnePipe webhook activation request not found for reference: ${fullReference}`);
            return { status: 'not_found' };
        }

        // Delegate to our robust processUserActivation
        return await this.processUserActivation({
            externalReferenceNumber: fullReference,
            event: 'PAYMENT_COMPLETE',
            status: 'SUCCESSFUL',
            paymentAmount: amount
        });
    }

    async processPagaCardWebhook(payload: any) {
        const reference = payload?.paymentReference;
        const amountPaid = Number(payload?.amount || 0);
        const statusMessage = (payload?.statusMessage as string | undefined)?.toUpperCase();

        if (statusMessage !== 'SUCCESS') {
            pagaLogger.error(`Paga card webhook status is not success: ${statusMessage}`);
            return { status: 'skipped' };
        }

        if (!reference) {
            pagaLogger.error('Paga card webhook missing reference');
            return { status: 'missing_reference' };
        }

        pagaLogger.info(`Paga card webhook received: reference=${reference}, amount=${amountPaid}`);

        // Route based on reference prefix
        if (reference.startsWith('ACTIVATION') && !reference.startsWith('ACTIVATIONCARD')) {
            // Check if user activation request exists
            const request = await prisma.userActivationRequest.findUnique({
                where: { reference }
            });

            if (request) {
                return await this.processUserActivation({
                    externalReferenceNumber: reference,
                    event: 'PAYMENT_COMPLETE',
                    status: 'SUCCESSFUL',
                    paymentAmount: amountPaid
                });
            } else {
                pagaLogger.error(`Paga card activation request not found for ref: ${reference}`);
                return { status: 'not_found' };
            }
        }

        if (reference.startsWith('PUK')) {
            const unblockingPayment = await prisma.unblockingPayment.findFirst({
                where: { reference }
            });

            if (unblockingPayment) {
                return await this.processPukUnblocking({
                    externalReferenceNumber: reference,
                    event: 'PAYMENT_COMPLETE',
                    status: 'SUCCESSFUL',
                    paymentAmount: amountPaid
                });
            } else {
                pagaLogger.error(`Paga card unblocking payment not found for ref: ${reference}`);
                return { status: 'not_found' };
            }
        }

        if (reference.startsWith('WARDSLOT')) {
            const slotPurchase = await prisma.guardianWardSlotPurchase.findUnique({
                where: { reference }
            });

            if (slotPurchase) {
                return await this.processWardSlotPurchase({
                    externalReferenceNumber: reference,
                    event: 'PAYMENT_COMPLETE',
                    status: 'SUCCESSFUL',
                    paymentAmount: amountPaid
                });
            } else {
                pagaLogger.error(`Paga card ward slot purchase not found for ref: ${reference}`);
                return { status: 'not_found' };
            }
        }

        if (reference.startsWith('ACTIVATIONCARD')) {
            const card = await prisma.activationCard.findFirst({
                where: { proofOfPayment: reference }
            });

            if (card) {
                return await this.processActivationCardPurchase({
                    externalReferenceNumber: reference,
                    event: 'PAYMENT_COMPLETE',
                    status: 'SUCCESSFUL',
                    paymentAmount: amountPaid
                });
            } else {
                pagaLogger.error(`Paga card activation card not found for ref: ${reference}`);
                return { status: 'not_found' };
            }
        }

        if (reference.startsWith('DIRECTWALLET') || reference.startsWith('INDIRECTWALLET') || reference.startsWith('WALLET')) {
            const fundingRecord = await prisma.manuallyFunding.findFirst({
                where: { receipt: reference },
                include: { wallet: { include: { user: true } } }
            });

            if (fundingRecord) {
                return await this.processPagaWebhook({
                    externalReferenceNumber: reference,
                    event: 'PAYMENT_COMPLETE',
                    status: 'SUCCESS',
                    paymentAmount: amountPaid
                });
            } else {
                pagaLogger.error(`Paga card funding record not found for ref: ${reference}`);
                return { status: 'not_found' };
            }
        }

        pagaLogger.error(`Paga card webhook reference prefix not handled: ${reference}`);
        return { status: 'unhandled_prefix' };
    }

    async generatePukVirtualAccount(userId: bigint, user: any) {
        if (!user.blockedAt) {
            throw new AppError('Your account is not blocked', 400);
        }

        // Throttle check (10 minutes)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const lastPending = await prisma.unblockingPayment.findFirst({
            where: {
                userId,
                status: false,
                createdAt: { gte: tenMinutesAgo }
            }
        });

        if (lastPending) {
            const minutesLeft = Math.ceil((lastPending.createdAt!.getTime() + 10 * 60 * 1000 - Date.now()) / (60 * 1000));
            throw new AppError(`Please wait ${minutesLeft} minute(s) before creating a new PUK request`, 400);
        }

        // Get PUK price setting
        const priceSetting = await prisma.setting.findFirst({
            where: { key: 'puk_price' }
        });
        const baseAmount = priceSetting ? Number(priceSetting.value) : 1000; // default to 1000 if not set

        const pagaService = new PagaService();
        const ref = pagaService.generateReference('PUK');
        const charge = pagaService.calculateCharge(baseAmount);
        const totalWithCharge = baseAmount + charge;

        // Generate paga virtual account
        const response = await pagaService.generateVirtualAccount(
            baseAmount,
            user.name || 'User',
            user.phone || '08000000000',
            ref
        );

        if (!response.success) {
            throw new AppError(response.error || 'Failed to generate virtual account', 400);
        }

        // Delete any old pending unblocking payments
        await prisma.unblockingPayment.deleteMany({
            where: {
                userId,
                status: false
            }
        });

        // Save unblocking payment record
        await prisma.unblockingPayment.create({
            data: {
                userId,
                bank: response.data.bank_name || 'Paga',
                accountNumber: response.data.virtual_account,
                accountName: response.data.account_name,
                reference: ref,
                amount: totalWithCharge,
                status: false,
                cloudinaryPublicId: ''
            }
        });

        return {
            status: true,
            account_detail: {
                account_name: response.data.account_name,
                bank_name: response.data.bank_name,
                account_number: response.data.virtual_account,
                expires_at: response.data.expiry_date_full ? format(new Date(response.data.expiry_date_full), 'HH:mm') : format(addMinutes(new Date(), 28), 'HH:mm'),
                amount: totalWithCharge,
                reference: ref
            }
        };
    }

    async unblockWithPuk(userId: bigint, puk: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            throw new AppError('User not found', 404);
        }

        if (user.unblockingCode !== puk) {
            throw new AppError('invalid PUK code', 400);
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                blockedAt: null,
                lastSeen: new Date()
            }
        });

        return {
            status: true,
            message: 'Your account has been unblocked successfully!'
        };
    }
}

