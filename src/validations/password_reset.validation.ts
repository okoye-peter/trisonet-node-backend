import { z } from "zod";

// `identifier` is an email or username; `username` is still accepted from older clients.
const identifierFields = {
    identifier: z.string().trim().min(1, 'email or username is required').max(255).optional(),
    username: z.string().trim().min(1, 'email or username is required').max(255).optional(),
};
const hasIdentifier = (data: { identifier?: string | undefined; username?: string | undefined }) => !!(data.identifier || data.username);
const identifierRequired = { message: 'email or username is required', path: ['identifier'] };

export const sendCustomerPasswordResetOtpSchema = z.object({
    body: z.object(identifierFields).refine(hasIdentifier, identifierRequired),
});

export const resetCustomerPasswordSchema = z.object({
    body: z.object({
        ...identifierFields,
        otp: z.string({ error: 'otp is required' }).regex(/^\d{6}$/, 'otp must be 6 digits'),
        password: z.string({ error: 'password is required' }).min(8, 'password must be at least 8 characters long').max(255, 'password must be at most 255 characters long'),
        confirmPassword: z.string({ error: 'confirm password is required' }).min(8, 'confirm password must be at least 8 characters long').max(255, 'confirm password must be at most 255 characters long'),
    }).refine(hasIdentifier, identifierRequired).refine((data) => data.password === data.confirmPassword, {
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