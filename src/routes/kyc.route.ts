import { Router } from "express";
import { protect } from "../middlewares/auth";
import { uploadKyc, updateUserBvnHash } from "../controllers/kyc.controller";
import { upload } from "../config/cloudinary";

const router = Router();

router.post("/update-bvn-hash", updateUserBvnHash);

router.use(protect); // Ensure user is authenticated

router.post("/verify", upload.fields([{ name: 'image', maxCount: 1 }]), uploadKyc);

export default router;
