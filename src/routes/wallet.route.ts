import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getAuthUserWallets, getWalletTransfers, transferFunds, getGkwthPrices, getWalletHistory } from "../controllers/wallet.controller";
import { validate } from "../middlewares/validateRequest";
import { transferFundsSchema } from "../validations/wallet.validation";



const router = Router();

router.use(protect);

router.get('/', getAuthUserWallets);
router.get('/history', getWalletHistory);
router.get('/transfers', getWalletTransfers);
router.get('/gkwth/prices', getGkwthPrices);
router.post('/transfer', validate(transferFundsSchema), transferFunds);

export default router;
