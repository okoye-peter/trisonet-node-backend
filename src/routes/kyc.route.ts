import { Router } from "express";
import { protect } from "../middlewares/auth";
import { kycDailyLimiter } from "../middlewares/rateLimiter";
import { uploadKyc, faceVerification, updateUserBvnHash, ninVerification, internationalPassportVerification, getAllUsersKycStats } from "../controllers/kyc.controller";
import { upload } from "../config/cloudinary";

const router = Router();

router.post("/update-bvn-hash", updateUserBvnHash);
router.get("/stats", getAllUsersKycStats);

router.use(protect); // Ensure user is authenticated

router.post("/verify", kycDailyLimiter, upload.fields([{ name: 'image', maxCount: 1 }]), uploadKyc);
router.post("/face-verify", kycDailyLimiter, upload.fields([{ name: 'image', maxCount: 1 }]), faceVerification);
router.post("/nin-verify", kycDailyLimiter, upload.fields([{ name: 'image', maxCount: 1 }]), ninVerification);
router.post("/passport-verify", kycDailyLimiter, upload.fields([{ name: 'image', maxCount: 1 }]), internationalPassportVerification);

export default router;
