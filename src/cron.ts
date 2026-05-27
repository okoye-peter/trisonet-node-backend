import cron from 'node-cron';
import { prisma } from './config/prisma';
import { PagaService } from './services/paga.service';
import { PaymentService } from './services/payment.service';
import { ACTIVATION_CARD_STATUSES, ROLES } from './config/constants';
import { pagaLogger } from './utils/logger';

const pagaService = new PagaService();
const paymentService = new PaymentService();

// Records younger than this haven't had time for the webhook to fire yet
const MIN_AGE_MINUTES = 3;
// Records older than this have virtual accounts that are long-expired
const MAX_AGE_HOURS = 2;
// Crucial batch limit to prevent event-loop starvation and server unresponsiveness
const BATCH_LIMIT = 20;

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

    // Added page chunking limit to avoid heavy blocking IO
    const pending = await prisma.userActivationRequest.findMany({
        where: {
            status: 'pending',
            reference: { not: null, startsWith: 'ACTIVATION' },
            createdAt: window,
        },
        select: { id: true, reference: true, amount: true },
        take: BATCH_LIMIT, 
    });

    if (pending.length === 0) return;

    pagaLogger.info(`[cron] Checking ${pending.length} pending activation request(s)`);

    for (const req of pending) {
        const reference = req.reference!;
        try {
            const verification = await pagaService.verifyPayment(reference);

            const innerStatus = verification.full_response?.data?.statusMessage?.toLowerCase();
            if (!verification.success || innerStatus !== 'success') {
                pagaLogger.info(`[cron] Activation request ${reference}: status="${innerStatus ?? 'unknown'}" — skipping`);
                continue;
            }

            pagaLogger.info(`[cron] Activation request ${reference}: payment confirmed — processing`);

            const paidAmount = verification.full_response?.data?.totalPaymentAmount
                ?? verification.full_response?.data?.requestAmount
                ?? verification.amount
                ?? Number(req.amount);

            const result = await paymentService.processUserActivation({
                externalReferenceNumber: reference,
                event: 'PAYMENT_COMPLETE',
                status: 'SUCCESSFUL',
                paymentAmount: paidAmount,
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

    // Added page chunking limit to avoid heavy blocking IO
    const pending = await prisma.activationCard.findMany({
        where: {
            status: ACTIVATION_CARD_STATUSES.PENDING,
            proofOfPayment: { startsWith: 'ACTIVATIONCARD' },
            createdAt: window,
        },
        select: { id: true, proofOfPayment: true, amount: true },
        take: BATCH_LIMIT,
    });

    if (pending.length === 0) return;

    pagaLogger.info(`[cron] Checking ${pending.length} pending activation card(s)`);

    for (const card of pending) {
        const reference = card.proofOfPayment!;
        try {
            const verification = await pagaService.verifyPayment(reference);

            const innerStatus = verification.full_response?.data?.statusMessage?.toLowerCase();
            if (!verification.success || innerStatus !== 'success') {
                pagaLogger.info(`[cron] Activation card ${reference}: status="${innerStatus ?? 'unknown'}" — skipping`);
                continue;
            }

            pagaLogger.info(`[cron] Activation card ${reference}: payment confirmed — processing`);

            const paidAmount = verification.full_response?.data?.totalPaymentAmount
                ?? verification.full_response?.data?.requestAmount
                ?? verification.amount
                ?? Number(card.amount);

            const result = await paymentService.processActivationCardPurchase({
                externalReferenceNumber: reference,
                event: 'PAYMENT_COMPLETE',
                status: 'SUCCESSFUL',
                paymentAmount: paidAmount,
            });

            pagaLogger.info(`[cron] Activation card ${reference}: result = ${JSON.stringify(result)}`);
        } catch (err: any) {
            pagaLogger.error(`[cron] Error verifying activation card ${reference}: ${err.message}`);
        }
    }
}

// ─── Job 3: Cleanup Stale Unpaid Records ─────────────────────────────────────

async function cleanupStaleRecords() {
    const expirationThreshold = new Date(Date.now() - (MAX_AGE_HOURS * 60 + 10) * 60 * 1000);

    try {
        const deletedRequests = await prisma.userActivationRequest.deleteMany({
            where: {
                status: 'pending',
                reference: { not: null, startsWith: 'ACTIVATION' },
                prove: null,
                createdAt: { lt: expirationThreshold },
            },
        });

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
    } catch (err: any) {
        pagaLogger.error(`[cron] Error running stale records cleanup: ${err.message}`);
    }
}



// ─── Job 4: Backfill Missing Transfer IDs ────────────────────────────────────

let isTransferIdCronRunning = false;

const EXCLUDED_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.INFANT_ADMIN, ROLES.SCHOOL];

async function generateUniqueTransferId(): Promise<string> {
    let transferId: string;
    do {
        transferId = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
    } while (await prisma.user.findUnique({ where: { transferId } }));
    return transferId;
}

async function backfillMissingTransferIds() {
    if (isTransferIdCronRunning) {
        pagaLogger.warn('[cron] Transfer ID backfill already running. Skipping.');
        return;
    }

    isTransferIdCronRunning = true;

    try {
        const users = await prisma.user.findMany({
            where: {
                transferId: null,
                role: { notIn: EXCLUDED_ROLES },
            },
            select: { id: true },
            take: BATCH_LIMIT,
        });

        if (users.length === 0) return;

        pagaLogger.info(`[cron] Backfilling transfer IDs for ${users.length} user(s)`);

        for (const user of users) {
            const transferId = await generateUniqueTransferId();
            await prisma.user.update({ where: { id: user.id }, data: { transferId } });
        }

        pagaLogger.info(`[cron] Transfer ID backfill complete for ${users.length} user(s)`);
    } catch (err: any) {
        pagaLogger.error(`[cron] Error during transfer ID backfill: ${err.message}`);
    } finally {
        isTransferIdCronRunning = false;
    }
}

// ─── Schedule Deployment: Multi-Instance Cluster Safe ───────────────────────

// PM2 gives every process an incremental index string ('0', '1', etc.) via NODE_APP_INSTANCE
const isPrimaryCluster = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

if (isPrimaryCluster) {
    pagaLogger.info('[cron] Primary cluster instance detected. Registering core automation routines.');

    cron.schedule('*/5 * * * *', async () => {
        if (isCronRunning) {
            pagaLogger.warn('[cron] Previous verification cycle is still running. Skipping this execution tick.');
            return;
        }

        isCronRunning = true;
        pagaLogger.info('[cron] Starting pending activation verification and cleanup pipeline...');

        try {
            // await verifyPendingActivationRequests();
            // await verifyPendingActivationCards();
            await cleanupStaleRecords();
        } catch (err: any) {
            pagaLogger.error(`[cron] Critical unhandled pipeline error: ${err.message}`);
        } finally {
            isCronRunning = false;
        }
    });
    cron.schedule('0 * * * *', async () => {
        await backfillMissingTransferIds();
    });
} else {
    pagaLogger.info(`[cron] Secondary cluster worker index (${process.env.NODE_APP_INSTANCE}) isolated: skipping scheduler binding.`);
}