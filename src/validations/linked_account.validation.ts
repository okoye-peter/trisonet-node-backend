import { z } from "zod";

export const requestLinkSchema = z.object({
    body: z.object({
        identifier: z.string({ error: "Enter the username or email of the partner account you want to link." }).trim().min(1, "Enter the username or email of the partner account you want to link."),
        // optional: sponsors have no real password and are verified by OTP only
        password: z.string().optional(),
    }),
});

export const verifyLinkSchema = z.object({
    body: z.object({
        otp: z.string({ error: "Enter the 6-digit verification code." }).regex(/^\d{6}$/, "The verification code must be exactly 6 digits."),
    }),
});

export const linkedUserIdSchema = z.object({
    params: z.object({
        userId: z.string().regex(/^\d+$/, "That partner account could not be found."),
    }),
});
