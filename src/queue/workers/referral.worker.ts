import { Worker, Job } from 'bullmq';
import { FundReferralsService } from '../../services/fund_referrals.service';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';

export const referralWorker = new Worker(
    'referralQueue',
    async (job: Job) => {
        if (job.name === 'fundReferrals') {
            const { userId, referralId } = job.data;
            await FundReferralsService.handle(BigInt(userId), BigInt(referralId));
        }
    },
    { connection: redisConnection, concurrency: 5 } // Handling concurrency to allow smooth scaling
);

referralWorker.on('completed', (job: Job) => {
    logger.info(`[Referral Worker] Job ${job.id} completed successfully`);
});

referralWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`[Referral Worker] Job ${job?.id} failed with error: ${err.message}`);
});
