import { Router } from "express";
import { protect } from "../middlewares/auth";
import { 
    generateVirtualAccountForWardSlotPurchase, 
    purchaseGkwth, 
    handlePagaWebhook,
    requestAssetLoan,
    checkFundingStatus,
    initiateDirectWalletFunding,
    initiateGkwthPurchase,
    getAssetLoans,
    verifyWardSlotPurchase,
    initiateActivationPayment,
    generateActivationRequestVirtualAccount,
    activateByCode,
    checkActivationStatus,
    submitActivationProof
} from "../controllers/payment.controller";
import { upload } from "../config/cloudinary";
import { validate } from "../middlewares/validateRequest";
import { initiateDirectWalletFundingSchema, initiateGkwthPurchaseSchema } from "../validations/wallet.validation";

const router = Router();

// Public routes
router.post('/webhook/paga', handlePagaWebhook);

// Protected routes
router.use(protect);
router.post('/wallet/direct/funding', validate(initiateDirectWalletFundingSchema),initiateDirectWalletFunding);
router.post('/wallet/indirect/funding', validate(initiateGkwthPurchaseSchema),initiateGkwthPurchase);

router.get('/wallet/check-status/:reference', checkFundingStatus);
router.post('/wards/generate-virtual-account', generateVirtualAccountForWardSlotPurchase);
router.post('/wards/purchase/verify', verifyWardSlotPurchase);
router.post('/gkwth/purchase', purchaseGkwth);
router.post('/gkwth/loan-request', requestAssetLoan);
router.get('/gkwth/loans', getAssetLoans);
router.post('/activation/initiate', initiateActivationPayment);
router.post('/activation/virtual-account', generateActivationRequestVirtualAccount);
router.post('/activation/code', activateByCode);
router.get('/activation/status/:reference', checkActivationStatus);
router.post('/activation/proof', upload.single('prove'), submitActivationProof);

export default router;