import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getAdminNotices } from "../controllers/admin_notice.controller";

const router = Router();

router.use(protect);

router.get("/", getAdminNotices);

export default router;
