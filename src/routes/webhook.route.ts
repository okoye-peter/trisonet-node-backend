import { Router } from 'express';
import {
    handlePagaWebhook,
    handlePagaCardWebhook,
    handleOnePipeWebhook,
} from '../controllers/webhook.controller';

const router = Router();

router.post('/', handlePagaWebhook);
router.post('/onepipe/webhooks', handleOnePipeWebhook);
router.post('/paga/card_payment/webhooks', handlePagaCardWebhook);

export default router;
