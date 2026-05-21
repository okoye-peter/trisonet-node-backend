import cron from 'node-cron';
import { prisma } from './config/prisma';
import { PagaService } from './services/paga.service';
import { PaymentService } from './services/payment.service';
import { ACTIVATION_CARD_STATUSES } from './config/constants';
import { pagaLogger } from './utils/logger';

const pagaService = new PagaService();
const paymentService = new PaymentService();

// Records younger than this haven't had time for the webhook to fire yet
const MIN_AGE_MINUTES = 30;
// Records older than this have virtual accounts that are long-expired
const MAX_AGE_HOURS = 2;

// Concurrency lock to prevent overlapping cron execution
let isCronRunning = false;

function ageWindow() {
    const now = Date.now();
    return {
        gte: new Date(now - MAX_AGE_HOURS * 60 * 60 * 1000),
        lte: new Date(now - MIN_AGE_MINUTES * 60 * 1000),
    };
}

// ─── Job 1: Pending User Activation Requests ─────────────────────────────────

async function verifyPendingActivationRequests() {
    const window = ageWindow();

    const pending = await prisma.userActivationRequest.findMany({
        where: {
            status: 'pending',
            reference: { not: null, startsWith: 'ACTIVATION' },
            createdAt: window,
        },
        select: { id: true, reference: true, amount: true },
    });

    if (pending.length === 0) return;

    pagaLogger.info(`[cron] Checking ${pending.length} pending activation request(s)`);

    for (const req of pending) {
        const reference = req.reference!;
        try {
            const verification = await pagaService.verifyPayment(reference);

            if (!verification.success || !verification.is_paid) {
                pagaLogger.info(`[cron] Activation request ${reference}: not yet paid — skipping`);
                continue;
            }

            pagaLogger.info(`[cron] Activation request ${reference}: payment confirmed — processing`);

            const result = await paymentService.processUserActivation({
                externalReferenceNumber: reference,
                event: 'PAYMENT_COMPLETE',
                status: 'SUCCESSFUL',
                paymentAmount: verification.amount ?? Number(req.amount),
            });

            pagaLogger.info(`[cron] Activation request ${reference}: result = ${JSON.stringify(result)}`);
        } catch (err: any) {
            pagaLogger.error(`[cron] Error verifying activation request ${reference}: ${err.message}`);
        }
    }
}

// ─── Job 2: Pending Activation Card Purchases ────────────────────────────────

async function verifyPendingActivationCards() {
    const window = ageWindow();

    const pending = await prisma.activationCard.findMany({
        where: {
            status: ACTIVATION_CARD_STATUSES.PENDING,
            proofOfPayment: { startsWith: 'ACTIVATIONCARD' },
            createdAt: window,
        },
        select: { id: true, proofOfPayment: true, amount: true },
    });

    if (pending.length === 0) return;

    pagaLogger.info(`[cron] Checking ${pending.length} pending activation card(s)`);

    for (const card of pending) {
        const reference = card.proofOfPayment!;
        try {
            const verification = await pagaService.verifyPayment(reference);

            if (!verification.success || !verification.is_paid) {
                pagaLogger.info(`[cron] Activation card ${reference}: not yet paid — skipping`);
                continue;
            }

            pagaLogger.info(`[cron] Activation card ${reference}: payment confirmed — processing`);

            const result = await paymentService.processActivationCardPurchase({
                externalReferenceNumber: reference,
                event: 'PAYMENT_COMPLETE',
                status: 'SUCCESSFUL',
                paymentAmount: verification.amount ?? Number(card.amount),
            });

            pagaLogger.info(`[cron] Activation card ${reference}: result = ${JSON.stringify(result)}`);
        } catch (err: any) {
            pagaLogger.error(`[cron] Error verifying activation card ${reference}: ${err.message}`);
        }
    }
}

// ─── Job 3: Cleanup Stale Unpaid Records ─────────────────────────────────────

async function cleanupStaleRecords() {
    // e.g., delete records older than 2hr + 10min to be safe
    const expirationThreshold = new Date(Date.now() - (MAX_AGE_HOURS * 60 + 10) * 60 * 1000);

    try {
        // Only delete Paga-originated pending requests that have no manual proof of payment
        const deletedRequests = await prisma.userActivationRequest.deleteMany({
            where: {
                status: 'pending',
                reference: { not: null, startsWith: 'ACTIVATION' },
                prove: null,
                createdAt: { lt: expirationThreshold },
            },
        });

        // Only delete Paga-originated pending cards (proofOfPayment = Paga reference)
        const deletedCards = await prisma.activationCard.deleteMany({
            where: {
                status: ACTIVATION_CARD_STATUSES.PENDING,
                proofOfPayment: { startsWith: 'ACTIVATIONCARD' },
                createdAt: { lt: expirationThreshold },
            },
        });

        if (deletedRequests.count > 0 || deletedCards.count > 0) {
            pagaLogger.info(
                `[cron] Cleanup complete. Deleted ${deletedRequests.count} stale activation request(s) and ${deletedCards.count} stale card(s).`
            );
        }
        
        /* 
        // Note: If you prefer keeping an audit trail instead of hard deleting, use this instead:
        await prisma.userActivationRequest.updateMany({
            where: { status: 'pending', createdAt: { lt: expirationThreshold } },
            data: { status: 'failed' }
        });
        */
    } catch (err: any) {
        pagaLogger.error(`[cron] Error running stale records cleanup: ${err.message}`);
    }
}

// ─── Schedule: Every 5 Minutes ───────────────────────────────────────────────

cron.schedule('*/5 * * * *', async () => {
    if (isCronRunning) {
        pagaLogger.warn('[cron] Previous verification cycle is still running. Skipping this execution tick.');
        return;
    }

    isCronRunning = true;
    pagaLogger.info('[cron] Starting pending activation verification and cleanup pipeline...');

    try {
        // Executed sequentially to prevent cross-db transaction failures or edge cases
        await verifyPendingActivationRequests();
        await verifyPendingActivationCards();
        await cleanupStaleRecords();
    } catch (err: any) {
        pagaLogger.error(`[cron] Critical unhandled pipeline error: ${err.message}`);
    } finally {
        isCronRunning = false;
    }
});