import { z } from "zod";

export const transferFundsSchema = z.object({
    body: z.object({
        receiverTransferId: z.string().min(3, 'Invalid account number').max(10, 'Invalid account number'),
        senderWalletId: z.string().min(1, 'Please select a wallet').max(10, 'Invalid account number'),
        amount: z.number().min(100, 'Minimum transfer amount is ₦100'),
        pin: z.string(),
    }),
});