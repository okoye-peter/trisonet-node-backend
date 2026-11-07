import { z } from "zod";

export const requestLinkSchema = z.object({
    body: z.object({
        identifier: z.string({ error: "username or email is required" }).trim().min(1, "username or email is required"),
        // optional: sponsors have no real password and are verified by OTP only
        password: z.string().optional(),
    }),
});

export const verifyLinkSchema = z.object({
    body: z.object({
        otp: z.string({ error: "verification code is required" }).regex(/^\d{6}$/, "verification code must be 6 digits"),
    }),
});

export const linkedUserIdSchema = z.object({
    params: z.object({
        userId: z.string().regex(/^\d+$/, "invalid account id"),
    }),
});
