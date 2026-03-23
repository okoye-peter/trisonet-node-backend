import { z } from "zod";

export const testGenerateVirtualAccountSchema = z.object({
    body: z.object({
        amount: z.coerce.number().min(100, 'Minimum amount is 100'),
        customerName: z.string().optional().default('Test User'),
        customerPhoneNumber: z.string().optional().default('08123456789'),
        reference: z.string().optional()
    }),
});
