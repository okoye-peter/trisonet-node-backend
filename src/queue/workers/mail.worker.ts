import { Worker, Job } from 'bullmq';
import { EmailService } from '../../services/email.service';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';

export const mailWorker = new Worker(
    'mailQueue',
    async (job: Job) => {
        if (job.name === 'sendWelcomeEmail') {
            const { email, name, password, intro } = job.data;
            await EmailService.sendWelcomeEmail(email, name, password, intro);
        }

        if (job.name === 'sendOtpEmail') {
            const { email, code } = job.data;
            await EmailService.sendOtpEmail(email, code);
        }
    },
    { connection: redisConnection, concurrency: 5 } // Handling concurrency
);

mailWorker.on('completed', (job: Job) => {
    logger.info(`[Mail Worker] Job ${job.id} completed successfully`);
});

mailWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error(`[Mail Worker] Job ${job?.id} failed with error: ${err.message}`);
});
