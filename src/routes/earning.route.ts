import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getAuthUserEarningTransactions } from "../controllers/earning.controller";

const router = Router();

// All earning routes are protected
router.use(protect);

router.get('/transactions', getAuthUserEarningTransactions);

export default router;
