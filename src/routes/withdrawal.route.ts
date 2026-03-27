import { Router } from "express";
import { protect, restrictTo } from "../middlewares/auth";
import { ROLES } from "../config/constants";
import * as withdrawalController from "../controllers/withdrawal.controller";

const router = Router();

router.use(protect);

router.get("/transactions", withdrawalController.getTransactions);
router.post("/initiate", withdrawalController.initiateTransfer);

// Admin only
router.get("/requests", restrictTo(ROLES.ADMIN, ROLES.SUPER_ADMIN), withdrawalController.getWithdrawalRequests);
router.post("/approve/:id", restrictTo(ROLES.ADMIN, ROLES.SUPER_ADMIN), withdrawalController.approveWithdrawal);

export default router;
