import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getUserReferrals, getAuthUser, getUserDashboardStats, updateProfile, updateBankDetails, updatePassword, getUserWards, getUserWardStats, getWardsSchoolFees, getUserByTransferId, resetWithdrawalPin, sendOtpForWithdrawalPinReset, getUserAwards } from "../controllers/user.controller";
import { validate } from "../middlewares/validateRequest";
import { changePasswordSchema } from "../validations/password_reset.validation";
import { otpLimiter } from "../middlewares/rateLimiter";

const router = Router();

router.use(protect);

router.get('/me', getAuthUser);
router.get('/awards', getUserAwards);
router.patch('/update', updateProfile);
router.patch('/update-bank', updateBankDetails);
router.patch('/update-password', validate(changePasswordSchema), updatePassword);
router.get('/referrals', getUserReferrals);
router.get('/dashboard-stats', getUserDashboardStats);
router.get('/wards', getUserWards);
router.get('/wards-stats', getUserWardStats);
router.get('/wards-school-fees', getWardsSchoolFees);
router.get('/lookup/:transferId', getUserByTransferId);
router.post('/reset-withdrawal-pin', resetWithdrawalPin);
router.post('/send-withdrawal-pin-otp', otpLimiter, sendOtpForWithdrawalPinReset);

export default router;