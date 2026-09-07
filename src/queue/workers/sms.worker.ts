import { Worker, Job } from 'bullmq';
import { TermiiService } from '../../services/termii.service';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';

export const smsWorker = new Worker(
    'smsQueue',
    async (job: Job) => {
        if (job.name === 'sendSms') {
            const { phoneNumber, message } = job.data;
            const result = await TermiiService.sendSms(phoneNumber, message);
            if (!result.status) throw new Error(`sendSms failed for ${phoneNumber}`);
        }
    },
    { connection: redisConnection, concurrency: 5 } // Handling concurrency
);

smsWorker.on('completed', (job: Job) => {
    logger.info(`[SMS Worker] Job ${job.id} completed successfully`);
});

smsWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`[SMS Worker] Job ${job?.id} failed with error: ${err.message}`);
});
