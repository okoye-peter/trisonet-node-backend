import { z } from 'zod';

export const createGroupSchema = z.object({
    body: z.object({
        name: z.string({ error: 'name is required' }).min(2, 'name must be at least 2 characters long').max(255, 'name must be at most 255 characters long'),
        amount: z.number({ error: 'amount is required' }).min(1000000, 'Amount must be at least 1,000,000'),
        type: z.enum(['individual', 'group']).optional(),
        plan: z.enum(['platinum', 'diamond', 'gold', 'silver', 'bronze', 'Platinum', 'Diamond', 'Gold', 'Silver', 'Bronze']).optional(),
        encrypted_card_data: z.string().optional(), // Keeping it as optional in case they use virtual accounts
    }),
});

export const addMemberSchema = z.object({
    body: z.object({
        name: z.string({ error: 'name is required' }).min(2, 'name must be at least 2 characters long'),
        email: z.string({ error: 'email is required' }).email('Please provide a valid email address'),
        phone: z.string({ error: 'phone is required' }).min(10, 'phone number must be at least 10 digits long'),
        password: z.string().optional(),
        username: z.string().optional(),
    }),
});

export const creditMemberSchema = z.object({
    body: z.object({
        amount: z.number({ error: 'amount is required' }).min(1000, 'Amount must be at least 1,000'),
        member_id: z.string({ error: 'member_id is required' }), // member_id will be sent as string (BigInt in DB)
    }),
});

export const fundGroupSchema = z.object({
    body: z.object({
        amount: z.number({ error: 'amount is required' }).min(1000000, 'Amount must be at least 1,000,000'),
        encrypted_card_data: z.string().optional(),
    }),
});
