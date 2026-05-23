import { Request, Response } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { PaymentService } from '../services/payment.service';
import { PagaService } from '../services/paga.service';
import { pagaLogger } from '../utils/logger';

const paymentService = new PaymentService();
const pagaService = new PagaService();

function verifyPagaSignature(req: Request, referenceNumber: string): boolean {
    const receivedHash = req.headers['hash'] as string | undefined;
    if (!receivedHash) return false;
    const expectedHash = pagaService.generateHash([referenceNumber]);
    return receivedHash === expectedHash;
}

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
    const externalReferenceNumber = req.body?.externalReferenceNumber;

    // pagaLogger.info(`[webhook] Paga bank-transfer webhook received`, {
    //     reference: externalReferenceNumber,
    //     body: req.body,
    // });

    // if (!verifyPagaSignature(req, externalReferenceNumber)) {
    //     pagaLogger.warn(`[webhook] Paga signature verification failed`, { reference: externalReferenceNumber });
    //     return res.status(401).json({ status: 'unauthorized' });
    // }

    const result = await paymentService.processPagaWebhook(req.body);
    return res.status(200).json(result);
});

/**
 * Paga card-payment (SDK / in-app card) webhook
 * Routes by paymentReference prefix — same business logic as the transfer webhook
 * but the payload shape differs (paymentReference, amount, statusMessage).
 */
export const handlePagaCardWebhook = asyncHandler(async (req: Request, res: Response) => {
    // Paga card webhooks wrap the actual payload in a nested `body` key
    const cardPayload = req.body?.body ?? req.body;
    const paymentReference = cardPayload?.paymentReference;

    pagaLogger.info(`[webhook] Paga card webhook received`, {
        reference: paymentReference,
        body: req.body,
    });

    // if (!verifyPagaSignature(req, paymentReference)) {
    //     pagaLogger.warn(`[webhook] Paga card signature verification failed`, { reference: paymentReference });
    //     return res.status(401).json({ status: 'unauthorized' });
    // }

    const result = await paymentService.processPagaCardWebhook(cardPayload);
    return res.status(200).json(result);
});

/**
 * OnePipe webhook
 * Only handles activation events (ACTIVATION{payment_id} references).
 * Payload: { details: { meta: { payment_id }, amount, status } }
 */
export const handleOnePipeWebhook = asyncHandler(async (req: Request, res: Response) => {
    pagaLogger.info(`[webhook] OnePipe webhook received`, { body: req.body });

    const result = await paymentService.processOnePipeWebhook(req.body);
    return res.status(200).json(result);
});
