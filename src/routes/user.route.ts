import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { getUserReferrals, getAuthUser, getUserDashboardStats, updateProfile, updateBankDetails, updatePassword, getUserWards, getUserWardStats, getWardsSchoolFees, getUserByTransferId, resetWithdrawalPin, verifyWithdrawalPinOtp, sendOtpForWithdrawalPinReset, getUserAwards, getActivationCandidates, sendEmailVerificationOtp, verifyEmailOtp } from "../controllers/user.controller";
import { validate } from "../middlewares/validateRequest";
import { changePasswordSchema } from "../validations/password_reset.validation";
import { updateBankDetailsSchema } from "../validations/bank.validation";
import { withdrawalPinOtpLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.use(protect);

// These endpoints must be accessible even when blocked — the frontend reads them
// to populate user state and decide whether to show the BlockedAccountModal.
router.get('/me', getAuthUser);
router.get('/dashboard-stats', getUserDashboardStats);
router.get('/awards', getUserAwards);
router.get('/referrals', getUserReferrals);
router.get('/wards', getUserWards);
router.get('/wards-stats', getUserWardStats);
router.get('/wards-school-fees', getWardsSchoolFees);
router.get('/lookup/:transferId', getUserByTransferId);
router.get('/activation-candidates', getActivationCandidates);

// Write operations are gated — blocked users cannot mutate their account
router.patch('/update', isBlocked, updateProfile);
router.patch('/update-bank', isBlocked, validate(updateBankDetailsSchema), updateBankDetails);
router.patch('/update-password', isBlocked, validate(changePasswordSchema), updatePassword);
router.post('/reset-withdrawal-pin', isBlocked, resetWithdrawalPin);
router.post('/verify-withdrawal-pin-otp', isBlocked, verifyWithdrawalPinOtp);
router.post('/send-withdrawal-pin-otp', isBlocked, withdrawalPinOtpLimiter, sendOtpForWithdrawalPinReset);
router.post('/send-email-verification-otp', isBlocked, sendEmailVerificationOtp);
router.post('/verify-email-otp', isBlocked, verifyEmailOtp);

export default router;