import { prisma, Prisma, WalletType } from "../config/prisma.js";
import { ROLES } from "../config/constants.js";
import NotificationService from "./notification.service";
import bcrypt from "bcryptjs";
import { AppError } from "../utils/AppError.js";

class WalletService {
    static async createWallets(userId: bigint, role: number, tx?: Prisma.TransactionClient, walletTypes?: WalletType[]) {
        const client = tx || prisma;
        const data: { userId: bigint; type: WalletType }[] = [];

        if (walletTypes && walletTypes.length > 0) {
            data.push(...walletTypes.map((type) => ({ userId, type })));
        } else if (role == ROLES.CUSTOMER) {
            data.push({ userId, type: WalletType.direct });
            data.push({ userId, type: WalletType.indirect });
        } else if (role == ROLES.PATRON) {
            data.push({ userId, type: WalletType.indirect });
            data.push({ userId, type: WalletType.patronage });
            data.push({ userId, type: WalletType.earning });
        }

        await client.wallet.createMany({
            data,
        });
    }

    static async transferFunds(senderId: bigint, receiverTransferId: string, senderWalletId: bigint, amount: number, pin: string) {
        let receiverData: any;
        let senderData: any;


        const user = await prisma.user.findFirst({
            where: {
                role: ROLES.CUSTOMER,
                level: {
                    gte: 2
                },
                id: senderId
            }
        })
        if(!user) {
            throw new AppError('only user that has migrated can make transfer', 400);
        }

        // Fetch commission_price for cross-country conversion ($1 = commission_price NGN)
        const commissionSetting = await prisma.setting.findUnique({ where: { key: 'commission_price' } });
        const commissionPrice = commissionSetting ? parseFloat(commissionSetting.value) || 0 : 0;

        const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // 1. Verify Sender
            const sender = await tx.user.findUnique({
                where: { id: senderId },
                select: {
                    id: true,
                    name: true,
                    country: true,
                    withdrawalPin: true,
                    status: true,
                    accountState: true,
                    isInfant: true
                }
            });
            senderData = sender;

            if (!sender || !sender.status || sender.accountState !== 1) {
                throw new Error('Sender account is inactive or restricted');
            }

            if (sender.isInfant) {
                throw new Error('Infants are not permitted to perform transfer');
            }

            const senderIsNigerianCheck = senderData?.country?.toLowerCase() === 'nigeria';
            const minAmount = senderIsNigerianCheck ? 100 : 1;
            if (amount < minAmount) {
                throw new Error(`Minimum transfer amount is ${senderIsNigerianCheck ? '₦100' : '$1'}`);
            }

            if (!sender.withdrawalPin) {
                throw new Error('Please go to your profile and set your transaction pin first');
            }

            const isPinValid = await bcrypt.compare(pin, sender.withdrawalPin);
            if (!isPinValid) {
                throw new Error('Wrong transaction pin');
            }

            // 2. Find Receiver
            const receiver = await tx.user.findFirst({
                where: {
                    transferId: receiverTransferId,
                    status: true,
                    accountState: 1,
                    isInfant: false
                },
                include: { wallets: true }
            });
            receiverData = receiver;

            if (!receiver) {
                throw new Error('Invalid transfer ID or receiver inactive');
            }

            if (receiver.id === sender.id) {
                throw new Error('Cannot transfer to yourself');
            }

            // 3. Find Sender Wallet & Check Balance
            const senderWallet = await tx.wallet.findUnique({
                where: { id: senderWalletId }
            });

            if (!senderWallet || senderWallet.userId !== sender.id) {
                throw new Error('Invalid wallet ID');
            }

            if (senderWallet.amount < amount) {
                throw new Error('Insufficient balance');
            }

            // 4. Find Receiver Wallet (MUST MATCH SENDER TYPE)
            let receiverWallet = receiver.wallets.find((w: any) => w.type === senderWallet.type);

            if (!receiverWallet) {
                throw new Error('Invalid receiver wallet type');
            }

            // 5. Determine credit amount — convert only when sender's country is explicitly non-Nigerian
            const senderCountry = senderData.country?.toLowerCase() ?? '';
            const receiverCountry = receiver.country?.toLowerCase() ?? '';
            const senderIsNigerian = senderCountry === 'nigeria';
            const receiverIsNigerian = receiverCountry === 'nigeria';

            // If sender country is unknown (null/empty), default to no conversion to prevent
            // accidental multiplication of same-currency transfers
            const shouldConvert = senderCountry !== '' && !senderIsNigerian && receiverIsNigerian && commissionPrice > 0;
            const creditAmount = shouldConvert ? amount * commissionPrice : amount;

            // 5. Perform Balances Update
            await tx.wallet.update({
                where: { id: senderWallet.id },
                data: { amount: { decrement: amount } }
            });

            await tx.wallet.update({
                where: { id: receiverWallet!.id },
                data: { amount: { increment: creditAmount } }
            });

            // 6. Create Transfer Log
            const reference = `TRF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const transfer = await tx.walletTransfer.create({
                data: {
                    senderWalletId: senderWallet.id,
                    receiverWalletId: receiverWallet!.id,
                    amount: BigInt(Math.floor(amount)),
                    reference
                }
            });

            return { transfer, senderIsNigerian, receiverIsNigerian, creditAmount };
        });

        const { transfer: transferResult, senderIsNigerian, receiverIsNigerian, creditAmount } = result;
        const senderCurrencySymbol = senderIsNigerian ? '₦' : '$';
        const receiverCurrencySymbol = receiverIsNigerian ? '₦' : '$';

        // Trigger Notifications
        try {
            await NotificationService.createNotification(
                [senderId],
                'Funds Transferred',
                `You have successfully transferred ${senderCurrencySymbol}${amount.toLocaleString()} to ${receiverTransferId}. Reference: ${transferResult.reference}`
            );

            await NotificationService.createNotification(
                [receiverData.id],
                'Funds Received',
                `You have received ${receiverCurrencySymbol}${creditAmount.toLocaleString()} from ${senderData.name || 'a user'}. Reference: ${transferResult.reference}`
            );
        } catch (error) {
            console.error('Failed to trigger transfer notifications:', error);
        }

        return transferResult;
    }
}

export default WalletService;