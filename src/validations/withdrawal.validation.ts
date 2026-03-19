import { z } from "zod";

export const initiateTransferSchema = z.object({
    body: z.object({
        amount: z.coerce.number().positive("Amount must be greater than 0"),
        bank_code: z.string().min(1, "Bank code is required"),
        bank_name: z.string().min(1, "Bank name is required"),
        account_name: z.string().min(1, "Account name is required"),
        account_number: z.string().min(10).max(12),
        wallet: z.coerce.string().min(1, "Wallet ID is required"),
        withdrawal_pin: z.string().length(4, "PIN must be 4 digits").optional(),
        withdrawal_otp: z.string().optional(),
        sponsor_email: z.string().email().optional(),
    })
});

export type InitiateTransferInput = z.infer<typeof initiateTransferSchema>['body'];
