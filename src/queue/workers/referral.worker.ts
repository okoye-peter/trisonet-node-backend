import { Worker, Job } from 'bullmq';
import { FundReferralsService } from '../../services/fund_referrals.service';
import { CommissionLogService } from '../../services/commission_log.service';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';

export const referralWorker = new Worker(
    'referralQueue',
    async (job: Job) => {
        if (job.name === 'fundReferrals') {
            const { userId, referralId, source, reference } = job.data;
            await FundReferralsService.handle(BigInt(userId), BigInt(referralId), source, reference);
        }
    },
    { connection: redisConnection, concurrency: 5 } // Handling concurrency to allow smooth scaling
);

referralWorker.on('completed', (job: Job) => {
    logger.info(`[Referral Worker] Job ${job.id} completed successfully`);
});

referralWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`[Referral Worker] Job ${job?.id} failed with error: ${err.message}`);

    // FundReferralsService.handle() already logs a CommissionLog entry for errors raised
    // inside its own try/catch. This only fires when the job died before/outside that
    // (e.g. worker crash, bad job payload) so the failure isn't silently untracked.
    if (job?.name === 'fundReferrals' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        const { userId, referralId, source, reference } = job.data ?? {};
        if (referralId) {
            CommissionLogService.failed({
                recipientId: BigInt(referralId),
                sourceUserId: userId ? BigInt(userId) : null,
                type: 'direct_referral',
                reason: `Referral commission job exhausted all retries and failed: ${err.message}`,
                reference: reference ?? null,
                processedVia: source ? `${source}->queue:referralQueue` : 'queue:referralQueue',
            }).catch(() => { /* already logs internally */ });
        }
    }
});
