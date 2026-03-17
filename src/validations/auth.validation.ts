import { z } from 'zod';

export const registerSchema = z.object({
    body: z.object({
        name: z.string({ error: 'name is required' }).min(2, 'name must be at least 2 characters long').max(255, 'name must be at most 255 characters long'),
        username: z.string({ error: 'username is required' }).min(2, 'username must be at least 2 characters long').max(50, 'username must be at most 50 characters long').regex(/^[a-zA-Z0-9]+$/, 'username must contain only alphabets, numbers, or a combination of both'),
        email: z.string({ error: 'email is required' }).email('Please provide a valid email address').max(255, 'email must be at most 255 characters long'),
        phone: z.string({ error: 'phone is required' }).min(10, 'phone number must be at least 10 digits long').max(15, 'phone number must be at most 15 digits long'),
        region_id: z.string({ error: 'region is required' }).min(1, 'region is required'),
        country: z.string({ error: 'country is required' }).min(1, 'country is required'),
        password: z.string({ error: 'password is required' }).min(8, 'password must be at least 8 characters long').max(255, 'password must be at most 255 characters long'),
        confirm_password: z.string({ error: 'confirm password is required' }).min(8, 'confirm password must be at least 8 characters long').max(255, 'confirm password must be at most 255 characters long'),
        referral_id: z.string({ error: 'referral id is required' }).min(1, 'referral id is required'),
        activation_code: z.string({ error: 'activation code is required' }).nullish(),
        picture_url: z.string().url().nullish()
    }).refine((data) => data.password === data.confirm_password, {
        message: 'Passwords do not match',
        path: ['confirm_password'],
    }),
});

export const loginSchema = z.object({
    body: z.object({
        email: z.string({ error: 'Email is required' }).email('Please provide a valid email address'),
        password: z.string({ error: 'Password is required' }).min(1, 'Password is required'),
    }),
});

export const refreshTokenSchema = z.object({
    body: z.object({
        refreshToken: z.string({ error: 'Refresh token is required' }).min(1, 'Refresh token is required'),
    }),
});
