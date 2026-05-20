import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getReels } from "../controllers/reel.controller";

const router = Router();

// Protect all reels routes
router.use(protect);

router.get("/", getReels);

export default router;
