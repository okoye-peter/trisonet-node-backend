import { z } from "zod";

export const sendCustomerPasswordResetOtpSchema = z.object({
    body: z.object({
        username: z.string({ error: 'username is required' }).min(1, 'username is required'),
    }),
});

export const resetCustomerPasswordSchema = z.object({
    body: z.object({
        username: z.string({ error: 'username is required' }).min(1, 'username is required'),
        otp: z.string({ error: 'otp is required' }).length(6, 'otp must be 6 digits'),
        password: z.string({ error: 'password is required' }).min(8, 'password must be at least 8 characters long').max(255, 'password must be at most 255 characters long'),
        confirmPassword: z.string({ error: 'confirm password is required' }).min(8, 'confirm password must be at least 8 characters long').max(255, 'confirm password must be at most 255 characters long'),
    }).refine((data) => data.password === data.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    }),
});

export const changePasswordSchema = z.object({
    body: z.object({
        currentPassword: z.string({ error: 'current password is required' }).min(8, 'current password must be at least 8 characters long'),
        password: z.string({ error: 'password is required' }).min(8, 'password must be at least 8 characters long').max(255, 'password must be at most 255 characters long'),
        confirmPassword: z.string({ error: 'confirm password is required' }).min(8, 'confirm password must be at least 8 characters long').max(255, 'confirm password must be at most 255 characters long'),
    }).refine((data) => data.password === data.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    }),
})