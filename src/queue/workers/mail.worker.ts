import { Worker, Job } from 'bullmq';
import { EmailService } from '../../services/email.service';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';

export const mailWorker = new Worker(
    'mailQueue',
    async (job: Job) => {
        if (job.name === 'sendWelcomeEmail') {
            const { email, name, password, intro } = job.data;
            const sent = await EmailService.sendWelcomeEmail(email, name, password, intro);
            if (!sent) throw new Error(`sendWelcomeEmail failed for ${email}`);
        }

        if (job.name === 'sendOtpEmail') {
            const { email, code } = job.data;
            const sent = await EmailService.sendOtpEmail(email, code);
            if (!sent) throw new Error(`sendOtpEmail failed for ${email}`);
        }

        if (job.name === 'sendPukEmail') {
            const { email, code } = job.data;
            const sent = await EmailService.sendPukEmail(email, code);
            if (!sent) throw new Error(`sendPukEmail failed for ${email}`);
        }

        if (job.name === 'sendOrderConfirmationEmail') {
            const { email, vars } = job.data;
            const sent = await EmailService.sendOrderConfirmationEmail(email, vars);
            if (!sent) throw new Error(`sendOrderConfirmationEmail failed for ${email}`);
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
