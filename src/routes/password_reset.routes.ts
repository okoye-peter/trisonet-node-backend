import { Router } from "express";
import { resetCustomerPassword, sendCustomerPasswordResetOtp } from "../controllers/password_reset.controller";
import { validate } from "../middlewares/validateRequest";
import { resetCustomerPasswordSchema, sendCustomerPasswordResetOtpSchema } from "../validations/password_reset.validation";

import { otpLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.post('/customers/send-otp', otpLimiter, validate(sendCustomerPasswordResetOtpSchema), sendCustomerPasswordResetOtp);
router.post('/customers/reset-password', validate(resetCustomerPasswordSchema), resetCustomerPassword);

export default router;