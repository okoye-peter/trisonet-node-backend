import { Worker, Job } from 'bullmq';
import { TermiiService } from '../../services/termii.service';
import { logger } from '../../utils/logger';

// Setup Redis options compatible with BullMQ
const connectionOpts = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
};

export const smsWorker = new Worker(
    'smsQueue',
    async (job: Job) => {
        if (job.name === 'sendSms') {
            const { phoneNumber, message } = job.data;
            await TermiiService.sendSms(phoneNumber, message);
        }
    },
    { connection: connectionOpts, concurrency: 5 } // Handling concurrency
);

smsWorker.on('completed', (job: Job) => {
    logger.info(`[SMS Worker] Job ${job.id} completed successfully`);
});

smsWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`[SMS Worker] Job ${job?.id} failed with error: ${err.message}`);
});
