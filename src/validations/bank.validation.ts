import { z } from "zod";

export const resolveBankAccountSchema = z.object({
    body: z.object({
        accountNumber: z.string({ error: 'Account number is required' }).min(10, 'Account number must be at least 10 digits long').max(10, 'Account number must be at most 10 digits long').regex(/^[0-9]+$/, 'Account number must contain only numbers'),
        bankUUID: z.string({ error: 'Bank UUID is required' }).uuid('Invalid bank UUID')
    })
})
