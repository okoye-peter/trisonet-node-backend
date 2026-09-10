import { Router } from "express";
import { protect, restrictTo } from "../middlewares/auth";
import { validate } from "../middlewares/validateRequest";
import { registerStoreGuestSchema } from "../validations/auth.validation";
import { ROLES } from "../config/constants";
import {
    registerStoreGuest,
    getInviteCode,
    getCommissionSummary,
    requestUpgrade,
    getUpgradeRequest,
} from "../controllers/store_guest.controller";

const router = Router();

router.post('/register', validate(registerStoreGuestSchema), registerStoreGuest);

router.use(protect);

router.get('/invite', getInviteCode);
router.get('/commission-summary', getCommissionSummary);
router.post('/upgrade-request', restrictTo(ROLES.STORE_GUEST), requestUpgrade);
router.get('/upgrade-request', restrictTo(ROLES.STORE_GUEST), getUpgradeRequest);

export default router;
