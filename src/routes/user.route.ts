import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getUserReferrals, getAuthUser, getUserDashboardStats, updateProfile, updatePassword, sendProfileUpdateOtp } from "../controllers/user.controller";
import { validate } from "../middlewares/validateRequest";
import { changePasswordSchema } from "../validations/password_reset.validation";

const router = Router();
router.use(protect);

router.get('/me', getAuthUser);
router.post('/send-otp', sendProfileUpdateOtp);
router.patch('/update', updateProfile);
router.patch('/update-password', validate(changePasswordSchema), updatePassword);
router.get('/referrals', getUserReferrals);
router.get('/dashboard-stats', getUserDashboardStats);

export default router;