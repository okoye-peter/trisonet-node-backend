import { z } from "zod";

export const transferFundsSchema = z.object({
    body: z.object({
        receiverTransferId: z.string().min(3, 'Invalid account number').max(10, 'Invalid account number'),
        senderWalletId: z.string().min(1, 'Please select a wallet').max(10, 'Invalid account number'),
        amount: z.number().min(100, 'Minimum transfer amount is ₦100'),
        pin: z.string(),
    }),
});

export const initiateDirectWalletFundingSchema = z.object({
    body: z.object({
        amount: z.coerce.number().min(500, 'Minimum funding amount is ₦500'),
    }),
})

export const initiateGkwthPurchaseSchema = z.object({
    body: z.object({
        gkwthAmount: z.coerce.number().min(1, 'Minimum gkwth amount is 1'),
    }),
})