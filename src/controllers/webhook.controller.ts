import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { PaymentService } from '../services/payment.service';
import { pagaLogger } from '../utils/logger';

const paymentService = new PaymentService();

/**
 * Paga virtual-account / bank-transfer webhook
 * Receives PAYMENT_COMPLETE / PARTIAL_PAYMENT events and routes by reference prefix:
 *   ACTIVATION*         → account activation
 *   PUK*                → PUK unblocking
 *   WARDSLOT*           → guardian ward-slot purchase
 *   ACTIVATIONCARD*     → PIM activation card purchase
 *   PG_FUND*            → patron group funding
 *   WALLET* / DIRECT_WALLET* / DIRECTWALLET* / INDIRECTWALLET* / GK_PURCHASE* → wallet / GKWTH funding
 */
export const handlePagaWebhook = asyncHandler(async (req: Request, res: Response) => {
    if (req.method !== 'POST') {
        pagaLogger.error('Paga webhook called with non-POST method');
        return res.status(200).json({ status: 'ok' });
    }

    const result = await paymentService.processPagaWebhook(req.body);
    return res.status(200).json(result);
});

/**
 * Paga card-payment (SDK / in-app card) webhook
 * Routes by paymentReference prefix — same business logic as the transfer webhook
 * but the payload shape differs (paymentReference, amount, statusMessage).
 */
export const handlePagaCardWebhook = asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentService.processPagaCardWebhook(req.body);
    return res.status(200).json(result);
});

/**
 * OnePipe webhook
 * Only handles activation events (ACTIVATION{payment_id} references).
 * Payload: { details: { meta: { payment_id }, amount, status } }
 */
export const handleOnePipeWebhook = asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentService.processOnePipeWebhook(req.body);
    return res.status(200).json(result);
});
