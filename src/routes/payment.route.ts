import { Router } from "express";
import { protect } from "../middlewares/auth";
import { 
    generateVirtualAccountForWardSlotPurchase, 
    purchaseGkwth, 
    handlePagaWebhook,
    requestAssetLoan,
    getAssetLoans
} from "../controllers/payment.controller";

const router = Router();

// Public routes
router.post('/webhook/paga', handlePagaWebhook);

// Protected routes
router.use(protect);
router.post('/wards/generate-virtual-account', generateVirtualAccountForWardSlotPurchase);
router.post('/gkwth/purchase', purchaseGkwth);
router.post('/gkwth/loan-request', requestAssetLoan);
router.get('/gkwth/loans', getAssetLoans);

export default router;