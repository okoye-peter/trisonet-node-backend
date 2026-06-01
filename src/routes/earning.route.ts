import { Router } from "express";
import { protect } from "../middlewares/auth";
import { isBlocked } from "../middlewares/isBlocked";
import { convertEarnings, getAuthUserEarningTransactions, getConversionInfo } from "../controllers/earning.controller";

const router = Router();

// All earning routes are protected
router.use(protect);
router.use(isBlocked);

router.get('/transactions', getAuthUserEarningTransactions);
router.get('/conversion-info', getConversionInfo);
router.post('/convert', convertEarnings);

export default router;
