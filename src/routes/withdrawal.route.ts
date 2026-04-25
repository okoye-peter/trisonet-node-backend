import { Router } from "express";
import { protect, restrictTo } from "../middlewares/auth";
import { ROLES } from "../config/constants";
import { approveWithdrawal, getTransactions, getWithdrawalRequests, initiateTransfer } from "../controllers/withdrawal.controller";

const router = Router();

router.use(protect);

router.get("/transactions", getTransactions);
router.post("/initiate", initiateTransfer);

// Admin only
router.get("/requests", restrictTo(ROLES.ADMIN, ROLES.SUPER_ADMIN), getWithdrawalRequests);
router.post("/approve/:id", restrictTo(ROLES.ADMIN, ROLES.SUPER_ADMIN), approveWithdrawal);

export default router;
