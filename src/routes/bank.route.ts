import { Router } from "express";
import { getBanksList, getUserBankDetails, resolveBankAccount } from "../controllers/bank.controller";
import { validate } from "../middlewares/validateRequest";
import { protect } from "../middlewares/auth";
import { resolveBankAccountSchema } from "../validations/bank.validation";


const router = Router();

router.get('/', getBanksList)
router.post('/resolve', protect, validate(resolveBankAccountSchema), resolveBankAccount);
router.get('/user', protect, getUserBankDetails);

export default router;