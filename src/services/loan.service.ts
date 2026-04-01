import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";

export class LoanService {
    /**
     * Create a new asset loan request
     */
    async createLoanRequest(userId: string, quantity: number, user: any) {
        // 1. Check Global Lock
        const lockSetting = await prisma.setting.findFirst({
            where: { key: 'lock_upfront_sale' }
        });

        if (lockSetting?.value === '1') {
            throw new AppError('Upfront sale is currently not available', 400);
        }

        // 2. Fetch User Wallets
        const wallets = await prisma.wallet.findMany({
            where: { userId: BigInt(userId) }
        });

        const indirectWallet = wallets.find((w: any) => w.type === 'indirect');
        if (!indirectWallet) {
            throw new AppError('Indirect wallet not found', 400);
        }

        // 3. Validate Quantity > Indirect Wallet Balance
        if (Number(quantity) <= indirectWallet.amount) {
            throw new AppError(`Requested quantity must be greater than your current indirect wallet balance (${indirectWallet.amount})`, 400);
        }

        // 4. Check Central Treasury
        const treasury = await prisma.wallet.findFirst({
            where: { type: 'central_treasury' }
        });

        if (!treasury || treasury.amount < Number(quantity)) {
            throw new AppError("The requested amount can't be granted currently, please request for something lower", 400);
        }

        // 5. Check Account Age (3 months)
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        if (new Date(user.createdAt) > threeMonthsAgo) {
            throw new AppError('Your account must be 3 months or older to be eligible', 400);
        }

        // 6. Check Referrals (at least 12)
        const activeReferralsCount = await prisma.user.count({
            where: {
                referralId: BigInt(userId),
                status: true
            }
        });

        if (activeReferralsCount < 12) {
            throw new AppError('You must have at least 12 active direct referrals to be eligible', 400);
        }

        // 7. Check Outstanding Loans
        const userLoans = await prisma.loan.findMany({
            where: {
                userId: BigInt(userId),
                status: 'granted'
            }
        });

        const isOwing = userLoans.some((l: any) => l.quantityGranted > l.quantityRepaid);

        if (isOwing) {
            throw new AppError("You can't request a new loan without paying up outstanding loans", 400);
        }

        // 8. Check Bank Details
        if (!user.bank || !user.accountNumber) {
            throw new AppError('Please update your bank details in your profile first', 400);
        }

        // 9. Create Loan Request
        return await prisma.loan.create({
            data: {
                userId: BigInt(userId),
                walletId: indirectWallet.id,
                quantityRequested: Number(quantity),
                status: 'pending'
            }
        });
    }
}
