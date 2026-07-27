import { z } from "zod";

export const resolveBankAccountSchema = z.object({
    body: z.object({
        accountNumber: z.string({ error: 'Account number is required' }).min(10, 'Account number must be at least 10 digits long').max(10, 'Account number must be at most 10 digits long').regex(/^[0-9]+$/, 'Account number must contain only numbers'),
        bankUUID: z.string({ error: 'Bank UUID is required' }).uuid('Invalid bank UUID')
    })
})

export const updateBankDetailsSchema = z.object({
    body: z.object({
        bank: z.string({ error: 'Bank name is required' }).min(1, 'Bank name is required'),
        bankUUID: z.string({ error: 'Bank UUID is required' }).uuid('Invalid bank UUID'),
        accountNumber: z.string({ error: 'Account number is required' }).min(10, 'Account number must be at least 10 digits long').max(10, 'Account number must be at most 10 digits long').regex(/^[0-9]+$/, 'Account number must contain only numbers'),
        currentPassword: z.string({ error: 'Password is required to update bank details' }).min(1, 'Password is required to update bank details')
    })
})
