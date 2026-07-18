import cron from 'node-cron';
import { prisma, WalletType } from './config/prisma';
import { PagaService } from './services/paga.service';
import { PaymentService } from './services/payment.service';
import { ACTIVATION_CARD_STATUSES, ROLES } from './config/constants';
import { activationCardFixLogger, pagaLogger } from './utils/logger';

const pagaService = new PagaService();
const paymentService = new PaymentService(); 

// Records younger than this haven't had time for the webhook to fire yet
const MIN_AGE_MINUTES = 3;
// Records older than this have virtual accounts that are long-expired
const MAX_AGE_HOURS = 2;
// Crucial batch limit to prevent event-loop starvation and server unresponsiveness
const BATCH_LIMIT = 20;
const FIX_ACTIVATION_CARD_BATCH_LIMIT = 10;
const FIX_ACTIVATION_CARD_LOOKBACK_DAYS = 5;
const REFERRAL_DEBIT_ACTIVATED_FROM = new Date('2026-05-24T00:00:00.000Z');
const ACTIVATION_CARD_FIX_RUN_KEY = 'activation_card_fix_unverified_payment_2026_05_24';

// Concurrency lock to prevent overlapping cron execution
let isCronRunning = false;
let isActivationCardFixRunning = false;
let hasActivationCardFixRun = false;

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

// ─── Job 4: Fix Approved Activation Cards With Unverified Payment ───────────

type ActivationCardFixRecord = {
    cardId: string;
    proofOfPayment: string;
    users: {
        userId: string;
        referralId: string | null;
        directWalletsDebited: number;
        indirectWalletsReset: number;
        deactivated: boolean;
    }[];
};

function activationCardFixCutoff() {
    return new Date(Date.now() - FIX_ACTIVATION_CARD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
}

function isPagaPaymentSuccessful(verification: any) {
    const fullResponse = verification.full_response ?? verification.data?.full_response ?? verification.data;
    const status = String(verification.status ?? '').toLowerCase();
    const statusMessage = String(fullResponse?.statusMessage ?? '').toLowerCase();
    const dataStatusMessage = String(fullResponse?.data?.statusMessage ?? '').toLowerCase();

    return verification.success === true
        && (verification.is_paid === true || status === 'success')
        && (!statusMessage || statusMessage === 'success')
        && (!dataStatusMessage || dataStatusMessage === 'success');
}

async function claimActivationCardFixRun() {
    try {
        await prisma.setting.create({
            data: {
                name: 'Activation card unverified payment fix 2026-05-24',
                key: ACTIVATION_CARD_FIX_RUN_KEY,
                dataType: 'string',
                value: `running:${new Date().toISOString()}`,
            },
        });

        return true;
    } catch (err: any) {
        if (err.code === 'P2002') {
            const existingRun = await prisma.setting.findUnique({
                where: { key: ACTIVATION_CARD_FIX_RUN_KEY },
                select: { value: true, updatedAt: true },
            });

            activationCardFixLogger.warn(
                `[activation-card-fix] Persistent run marker exists. Skipping. value=${existingRun?.value ?? 'unknown'} updatedAt=${existingRun?.updatedAt?.toISOString() ?? 'unknown'}`
            );
            return false;
        }

        throw err;
    }
}

export async function fixActivationCardsWithUnverifiedPayment() {
    if (hasActivationCardFixRun) {
        activationCardFixLogger.warn('[activation-card-fix] One-time fix has already run. Skipping.');
        return;
    }

    if (isActivationCardFixRunning) {
        activationCardFixLogger.warn('[activation-card-fix] Fix is already running. Skipping.');
        return;
    }

    isActivationCardFixRunning = true;

    const summary = {
        checkedCards: 0,
        affectedCards: 0,
        deletedCards: 0,
        usersDeactivated: 0,
        directWalletsDebited: 0,
        indirectWalletsReset: 0,
        skippedCards: 0,
        errors: [] as { cardId?: string; proofOfPayment?: string; message: string }[],
        records: [] as ActivationCardFixRecord[],
    };

    try {
        const shouldRun = await claimActivationCardFixRun();
        hasActivationCardFixRun = true;

        if (!shouldRun) return;

        const cutoff = activationCardFixCutoff();
        let lastSeenId: bigint | undefined;

        activationCardFixLogger.info(`[activation-card-fix] Starting one-time fix. cutoff=${cutoff.toISOString()}`);

        while (true) {
            const activationCards = await prisma.activationCard.findMany({
                where: {
                    status: ACTIVATION_CARD_STATUSES.APPROVED,
                    proofOfPayment: { startsWith: 'ACTIVATIONCARD' },
                    createdAt: { gte: cutoff },
                    ...(lastSeenId ? { id: { gt: lastSeenId } } : {}),
                },
                orderBy: { id: 'asc' },
                take: FIX_ACTIVATION_CARD_BATCH_LIMIT,
                select: {
                    id: true,
                    proofOfPayment: true,
                },
            });

            if (activationCards.length === 0) break;

            for (const card of activationCards) {
                lastSeenId = card.id;
                summary.checkedCards += 1;

                const proofOfPayment = card.proofOfPayment;
                if (!proofOfPayment) {
                    summary.skippedCards += 1;
                    continue;
                }

                try {
                    const verification = await pagaService.verifyPayment(proofOfPayment);

                    if (isPagaPaymentSuccessful(verification)) {
                        summary.skippedCards += 1;
                        continue;
                    }

                    const users = await prisma.user.findMany({
                        where: {
                            status: true,
                            activationCardId: card.id,
                        },
                        select: {
                            id: true,
                            referralId: true,
                            activatedAt: true,
                        },
                    });

                    const record: ActivationCardFixRecord = {
                        cardId: card.id.toString(),
                        proofOfPayment,
                        users: [],
                    };

                    for (const user of users) {
                        let directWalletsDebited = 0;

                        if (user.activatedAt && user.activatedAt >= REFERRAL_DEBIT_ACTIVATED_FROM && user.referralId) {
                            const directWalletUpdate = await prisma.wallet.updateMany({
                                data: {
                                    amount: { decrement: 2000 },
                                },
                                where: {
                                    type: WalletType.direct,
                                    userId: user.referralId,
                                },
                            });

                            directWalletsDebited = directWalletUpdate.count;
                            summary.directWalletsDebited += directWalletUpdate.count;
                        }

                        const indirectWalletUpdate = await prisma.wallet.updateMany({
                            data: {
                                amount: 0,
                            },
                            where: {
                                type: WalletType.indirect,
                                userId: user.id,
                            },
                        });

                        await prisma.user.update({
                            data: {
                                status: false,
                                activatedAt: null,
                                activationCardId: null,
                            },
                            where: {
                                id: user.id,
                            },
                        });

                        summary.indirectWalletsReset += indirectWalletUpdate.count;
                        summary.usersDeactivated += 1;
                        record.users.push({
                            userId: user.id.toString(),
                            referralId: user.referralId?.toString() ?? null,
                            directWalletsDebited,
                            indirectWalletsReset: indirectWalletUpdate.count,
                            deactivated: true,
                        });
                    }

                    await prisma.activationCard.delete({
                        where: { id: card.id },
                    });

                    summary.affectedCards += 1;
                    summary.deletedCards += 1;
                    summary.records.push(record);

                    activationCardFixLogger.info(`[activation-card-fix] Activation card ${card.id.toString()} removed after failed verification`, record);
                } catch (err: any) {
                    summary.errors.push({
                        cardId: card.id.toString(),
                        proofOfPayment,
                        message: err.message ?? 'Unknown error',
                    });
                    activationCardFixLogger.error(`[activation-card-fix] Error fixing activation card ${card.id.toString()}: ${err.message}`);
                }
            }
        }

        const completedValue = summary.errors.length > 0
            ? `completed_with_errors:${new Date().toISOString()}`
            : `completed:${new Date().toISOString()}`;

        await prisma.setting.update({
            where: { key: ACTIVATION_CARD_FIX_RUN_KEY },
            data: { value: completedValue },
        });

        activationCardFixLogger.info(`[activation-card-fix] Summary: ${JSON.stringify(summary)}`);
        return summary;
    } catch (err: any) {
        activationCardFixLogger.error(`[activation-card-fix] Fatal error: ${err.message}`);
        throw err;
    } finally {
        isActivationCardFixRunning = false;
    }
}



// ─── Job 5: Backfill Missing Transfer IDs ────────────────────────────────────

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
            await backfillMissingTransferIds();
        } catch (err: any) {
            pagaLogger.error(`[cron] Critical unhandled pipeline error: ${err.message}`);
        } finally {
            isCronRunning = false;
        }
    });
    // void fixActivationCardsWithUnverifiedPayment();
    // cron.schedule('0 * * * *', async () => {
        //     await backfillMissingTransferIds();
    // });
} else {
    pagaLogger.info(`[cron] Secondary cluster worker index (${process.env.NODE_APP_INSTANCE}) isolated: skipping scheduler binding.`);
}
