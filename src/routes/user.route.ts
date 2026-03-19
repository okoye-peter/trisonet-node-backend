import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getUserReferrals, getAuthUser, getUserDashboardStats, updateProfile, updatePassword, sendProfileUpdateOtp, getUserWards, getUserWardStats, getWardsSchoolFees, getUserByTransferId } from "../controllers/user.controller";
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
router.get('/wards', getUserWards);
router.get('/wards-stats', getUserWardStats);
router.get('/wards-school-fees', getWardsSchoolFees);
router.get('/lookup/:transferId', getUserByTransferId);

export default router;