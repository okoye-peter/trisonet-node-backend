import { Router } from "express";
import { testGenerateVirtualAccount } from "../controllers/paga_test.controller";
import { validate } from "../middlewares/validateRequest";
import { testGenerateVirtualAccountSchema } from "../validations/paga.validation";

const router = Router();

router.post('/generate-virtual-account', validate(testGenerateVirtualAccountSchema), testGenerateVirtualAccount);

export default router;
