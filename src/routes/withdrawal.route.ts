import { Router } from "express";
import { getTransactions, initiateTransfer } from "../controllers/withdrawal.controller";
import { protect } from "../middlewares/auth";
import { validate } from "../middlewares/validateRequest";
import { initiateTransferSchema } from "../validations/withdrawal.validation";

const router = Router();
router.use(protect)

router.get('/transactions', getTransactions);
router.post('/', validate(initiateTransferSchema), initiateTransfer);

export default router;
