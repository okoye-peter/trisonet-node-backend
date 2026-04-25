import { prisma, Prisma } from "../config/prisma";
import { ROLES, WITHDRAWAL_STATUSES } from "../config/constants";
import NotificationService from "./notification.service";
import { differenceInHours, differenceInDays } from "date-fns";
import { AppError } from "../utils/AppError";
import bcrypt from "bcryptjs";
import { InitiateTransferInput } from "../validations/withdrawal.validation";
import { PagaService } from "./paga.service";

export class WithdrawalService {
    /**
     * Calculate withdrawal charges based on amount tiers
     */
    static getWithdrawalCharges(amount: number): number {
        if (amount <= 5000) return 100;
        if (amount <= 50000) return 200;
        if (amount <= 100000) return 300;
        if (amount <= 200000) return 500;
        return 1000;
    }

    /**
     * Check if a user is eligible to withdraw based on their status and referrals
     */
    static async checkUserStatusToWithdraw(user: any): Promise<{ status: boolean; error?: string }> {
        // 1 hour bypass check
        if (user.withdrawalBypassAt && differenceInHours(new Date(), user.withdrawalBypassAt) < 1) {
            return { status: true };
        }

        if (user.role === ROLES.CUSTOMER) {
            const activeReferralsCount = await prisma.user.count({
                where: {
                    referralId: user.id,
                    status: true
                }
            });

            if (activeReferralsCount < 6) {
                return { status: false, error: "you can't withdraw until you distribute up to 6 units" };
            }

            const lastWithdrawal = await prisma.withDrawal.findFirst({
                where: {
                    userId: user.id,
                    NOT: {
                        accountNumber: { in: ['direct wallet', 'indirect wallet'] }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            if (lastWithdrawal && lastWithdrawal.createdAt) {
                const daysSinceLastWithdrawal = differenceInDays(new Date(), lastWithdrawal.createdAt);
                if (daysSinceLastWithdrawal < 7) {
                    return { status: false, error: `You can only withdraw once every 7 days. Please wait ${7 - daysSinceLastWithdrawal} more day(s).` };
                }
            }

            if (lastWithdrawal) {
                const recentRefs = await prisma.user.count({
                    where: {
                        referralId: user.id,
                        status: true,
                        createdAt: { gte: lastWithdrawal.createdAt! }
                    }
                });

                if (recentRefs < 6) {
                    const remaining = 6 - (recentRefs % 6);
                    return { status: false, error: `you can't withdraw until you distribute up to ${remaining} units since your last withdrawal` };
                }
            }
        } else if (user.role === ROLES.INFLUENCER) {
            const lastWithdrawal = await prisma.withDrawal.findFirst({
                where: {
                    userId: user.id,
                    NOT: {
                        accountNumber: { in: ['direct wallet', 'indirect wallet'] }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            if (lastWithdrawal && lastWithdrawal.createdAt) {
                const daysSinceLastWithdrawal = differenceInDays(new Date(), lastWithdrawal.createdAt);
                if (daysSinceLastWithdrawal < 7) {
                    return { status: false, error: `You can only withdraw once every 7 days. Please wait ${7 - daysSinceLastWithdrawal} more day(s).` };
                }
            }

            if (lastWithdrawal) {
                const recentInfluenced = await prisma.user.count({
                    where: {
                        influencerId: user.id,
                        status: true,
                        createdAt: { gte: lastWithdrawal.createdAt! }
                    }
                });

                if (recentInfluenced < 6) {
                    const remaining = 6 - (recentInfluenced % 6);
                    return { status: false, error: `you can't withdraw until you distribute up to ${remaining} units since your last withdrawal` };
                }
            }
        }

        return { status: true };
    }

    /**
     * Initiate a transfer request
     */
    static async initiateTransfer(user: any, input: InitiateTransferInput, type?: string) {
        // Optimization: Fetch all needed settings at once
        const settingsKeys = ['lock_withdrawal', 'lock_direct_withdrawal', 'lock_indirect_withdrawal', 'gkwth_purchase_price'];
        const settings = await prisma.setting.findMany({
            where: { key: { in: settingsKeys } }
        });

        const settingsMap = Object.fromEntries(settings.map((s: any) => [s.key, s.value]));

        // 1. Global Lock Check
        if (settingsMap['lock_withdrawal'] === '1') {
            throw new AppError('Withdrawal currently not available, try again later', 400);
        }

        // 2. User Permission & Details Check
        if (user.role !== ROLES.PATRON && !user.canWithdraw) {
            throw new AppError('Withdrawal currently not available for this account, contact admin for assistance', 400);
        }

        if (user.role !== ROLES.PATRON && (!user.bank || !user.accountNumber)) {
            throw new AppError('Please update your bank details first', 400);
        }

        const rolesRequiringPin = [ROLES.CUSTOMER, ROLES.SCHOOL, ROLES.INFLUENCER];
        if (rolesRequiringPin.includes(user.role) && !user.withdrawalPin) {
            throw new AppError('Please update your transaction pin first', 400);
        }

        if (type === 'opt-out') {
            return { success: true, message: 'Opt-out handled (logic placeholder)' };
        }

        const walletId = BigInt(input.wallet);

        if (!user.status) {
            throw new AppError("Your account isn't activated, activate your account first", 400);
        }

        if (user.isInfant) {
            throw new AppError("Infants aren't allowed to withdraw until account has been upgraded to adult account", 400);
        }

        // 4. Wallet Check
        const wallet = await prisma.wallet.findFirst({
            where: { id: walletId, userId: user.id }
        });

        if (!wallet) {
            throw new AppError('Invalid wallet selected', 400);
        }

        // New Rule: Max 50% withdrawal limit
        if (wallet.type == 'earning') {
            if (input.amount > (wallet.amount * 0.5)) throw new AppError(`Note: You can only withdraw up to 50% of your total balance. Current maximum: ₦${(wallet.amount * 0.5).toLocaleString()}`, 400);
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const last = await prisma.earningTransaction.findFirst({
                where: {
                    type: 'debit',
                    walletId: wallet.id,
                    narration: {
                        contains: 'withdrawal'
                    },
                    createdAt: {
                        gte: sevenDaysAgo
                    }
                }
            });

            if (last) {
                throw new AppError('You can only withdraw once every 7 days', 400);
            }
        }


        if (wallet.type === 'indirect' && !user.canWithdrawGkwth) {
            throw new AppError('Your account has been restricted from withdrawing GKWTH', 400);
        }

        if (wallet.amount < input.amount) {
            throw new AppError('Insufficient balance', 400);
        }

        // 5. PIN Verification
        if (user.role !== ROLES.PATRON) {
            if (!input.withdrawal_pin) {
                throw new AppError('Withdrawal PIN is required', 400);
            }
            const isPinValid = await bcrypt.compare(input.withdrawal_pin, user.withdrawalPin!);
            if (!isPinValid) {
                throw new AppError('Invalid withdrawal pin', 400);
            }
        }

        // 6. OTP Verification for Patrons
        if (user.role === ROLES.PATRON) {
            if (!input.withdrawal_otp || Number(input.withdrawal_otp) !== user.sponsorWithdrawalOtp) {
                throw new AppError('Invalid withdrawal OTP', 400);
            }
        }

        // 7. Pending Request Check
        const pendingRequestCount = await prisma.withdrawalRequest.count({
            where: {
                OR: [
                    { userEmail: user.username || user.email || '' },
                    { walletId: wallet.id }
                ],
                status: 'pending'
            }
        });

        if (pendingRequestCount > 0) {
            throw new AppError('You already have a pending withdrawal request that hasn\'t been resolved', 400);
        }

        // 8. User Eligibility Check
        if (user.role !== ROLES.PATRON) {
            const eligibility = await this.checkUserStatusToWithdraw(user);
            if (!eligibility.status) {
                throw new AppError(eligibility.error || 'Withdrawal restricted', 400);
            }
        }

        let amountCalculated = 0;
        let priceValue: number | null = (wallet.type === 'earning') || (wallet.type === 'indirect') ? Number(settingsMap['gkwth_purchase_price'] || 0) : null;

        // 9. Wallet Specific Locks & Amount Calculation
        if (wallet.type === 'direct') {
            if (settingsMap['lock_direct_withdrawal'] === '1') {
                throw new AppError('Cash withdrawal currently not available. Try again later.', 400);
            }
            amountCalculated = input.amount;
        } else if (wallet.type === 'indirect') {
            if (settingsMap['lock_indirect_withdrawal'] === '1') {
                throw new AppError('Attention!, Asset Buyers Are Not Available At the Moment, Please Try Again Later', 400);
            }

            if (wallet.amount - input.amount < 1) {
                throw new AppError("Your GKWTH balance can't be less than 1 after withdrawal.", 400);
            }

            amountCalculated = user.country === "Nigeria" ? input.amount * priceValue : input.amount * 10;
        }

        // 10. Transaction
        const request = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const currentWallet = await tx.wallet.findUnique({ where: { id: walletId! } });
            if (!currentWallet || currentWallet.amount < input.amount) {
                throw new AppError('Insufficient balance', 400);
            }

            const newBalance = currentWallet.amount - input.amount;
            if (wallet.type === 'indirect' && newBalance < 1) {
                throw new AppError('Insufficient balance (GKWTH must remain above 1)', 400);
            }

            const oldBalanceStr = wallet.type === 'indirect' ? `${currentWallet.amount}gkwth` : `${currentWallet.amount}`;
            const newBalanceStr = wallet.type === 'indirect' ? `${newBalance}gkwth` : `${newBalance}`;

            // Decrement wallet
            await tx.wallet.update({
                where: { id: wallet.id },
                data: { amount: { decrement: input.amount } }
            });

            // Increment Central Treasury if indirect
            if (wallet.type === 'indirect') {
                const centralTreasury = await tx.wallet.findFirst({ where: { type: 'central_treasury' } });
                if (centralTreasury) {
                    await tx.wallet.update({
                        where: { id: centralTreasury.id },
                        data: { amount: { increment: input.amount } }
                    });

                    // Log Central Treasury Transaction
                    await tx.centralTreasuryLog.create({
                        data: {
                            transactionType: 'purchase',
                            walletId: wallet.id,
                            performedBy: user.id,
                            amount: input.amount
                        }
                    });
                }
            }

            const charges = this.getWithdrawalCharges(amountCalculated);
            const amountToTransfer = amountCalculated - charges;
            const email = user.email || user.username || '';

            const userTypeMap: Record<number, string> = {
                [ROLES.SPONSOR]: 'sponsor',
                [ROLES.CUSTOMER]: 'customer',
                [ROLES.INFLUENCER]: 'influencer',
                [ROLES.PATRON]: 'patron'
            };
            const userType = userTypeMap[user.role as number] || 'user';

            return await tx.withdrawalRequest.create({
                data: {
                    amountRequested: amountCalculated,
                    amountToTransfer: amountToTransfer,
                    walletId: wallet.id,
                    bankName: input.bank_name,
                    bankCode: input.bank_code,
                    accountNumber: input.account_number,
                    accountName: input.account_name,
                    gkwthValue: priceValue,
                    gkwthAmount: (wallet.type === 'indirect' || wallet.type === 'earning') ? input.amount : null,
                    userEmail: email,
                    userType: userType as any,
                    oldBalance: oldBalanceStr,
                    newBalance: newBalanceStr,
                    status: 'pending'
                }
            });
        });

        // Trigger Notification
        try {
            await NotificationService.createNotification(
                [user.id],
                'Withdrawal Initiated',
                `Your withdrawal request of ₦${amountCalculated.toLocaleString()} has been received and is pending approval.`
            );
        } catch (error) {
            console.error('Failed to create withdrawal notification:', error);
            // Don't throw error here to avoid failing the whole process
        }

        return request;
    }

    /**
     * Approve and process a withdrawal request
     */
    static async approveWithdrawal(requestId: bigint, adminUser: any) {
        const request = await prisma.withdrawalRequest.findUnique({
            where: { id: requestId },
            include: { wallet: { include: { user: true } } }
        });

        if (!request) {
            throw new AppError('Withdrawal request not found', 404);
        }

        if (!request.wallet) {
            throw new AppError('Wallet associated with this request not found', 404);
        }

        const wallet = request.wallet;

        if (request.status !== 'pending') {
            throw new AppError(`Request already ${request.status}`, 400);
        }

        const pagaService = new PagaService();

        // 1. Mark as being processed
        await prisma.withdrawalRequest.update({
            where: { id: requestId },
            data: { status: 'being_processed' }
        });

        try {
            if (!request.bankCode) {
                throw new AppError('Bank code is missing from the withdrawal request', 400);
            }

            // 2. Execute Transfer via Paga
            const payoutResponse = await pagaService.withdrawToBank(
                request.amountToTransfer,
                request.bankCode,
                request.accountNumber,
                pagaService.generateReference('WD_PAID'),
                { remarks: `Withdrawal for ${request.userEmail}` }
            );

            if (!payoutResponse.success) {
                // Revert status to pending or mark as failed
                await prisma.withdrawalRequest.update({
                    where: { id: requestId },
                    data: { status: 'pending' }
                });
                throw new AppError(payoutResponse.error || 'Paga transfer failed', 400);
            }

            // 3. Finalize in DB
            await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                // Update Request Status
                await tx.withdrawalRequest.update({
                    where: { id: requestId },
                    data: { status: 'processed' }
                });

                // Create WithDrawal Log (The historical record)
                await tx.withDrawal.create({
                    data: {
                        userId: wallet.userId,
                        amount: request.amountRequested.toString(),
                        bankName: request.bankName,
                        accountNumber: request.accountNumber,
                        isPaid: WITHDRAWAL_STATUSES.SUCCESS,
                        oldBalance: request.oldBalance || '',
                        newBalance: request.newBalance || '',
                        gkwthPrice: request.gkwthValue ? Number(request.gkwthValue) : null,
                        pagaRef: payoutResponse.reference,
                        pagaTransactionId: payoutResponse.transaction_id
                    }
                });

                if(wallet.type === 'earning') {
                    await tx.earningTransaction.create({
                        data: {
                            amount: request.amountRequested,
                            type: 'debit',
                            reference: payoutResponse.reference,
                            walletId: wallet.id,
                            narration: 'withdrawal'
                        }
                    });            
                }
                // 4. Notify User
                await NotificationService.createNotification(
                    [wallet.userId],
                    'Withdrawal Successful',
                    `Your withdrawal of ₦${request.amountToTransfer.toLocaleString()} has been processed and sent to your bank account.`
                );

                return { success: true, reference: payoutResponse.reference };

            });
        } catch (error: any) {
                // If it's an AppError we threw, rethrow it
                if (error instanceof AppError) throw error;

                // Otherwise, revert status and throw
                await prisma.withdrawalRequest.update({
                    where: { id: requestId },
                    data: { status: 'pending' }
                });
                throw new AppError(error.message || 'An error occurred during payout', 500);
            }
        }
}
