import { Router } from "express";
import { protect } from "../middlewares/auth";
import { uploadKyc } from "../controllers/kyc.controller";
import { upload } from "../config/cloudinary";

const router = Router();

router.use(protect); // Ensure user is authenticated

router.post("/verify", upload.fields([{ name: 'image', maxCount: 1 }]), uploadKyc);

export default router;
