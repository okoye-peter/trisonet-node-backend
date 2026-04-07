import { Router } from "express";
import { protect } from "../middlewares/auth";
import { generateVirtualAccountForCardPurchase, getUserCards, getUserCardsSummary, verifyCardPurchasePayment } from "../controllers/pim_activation_cards.controller";
import { validate } from "../middlewares/validateRequest";
import { cardPurchaseSchema } from "../validations/pim_card.validation";

const router = Router();

router.use(protect)

router.get('/summary', getUserCardsSummary);
router.get('/', getUserCards);
router.post('/verify-payment/', verifyCardPurchasePayment);
router.post('/', validate(cardPurchaseSchema), generateVirtualAccountForCardPurchase);

export default router;