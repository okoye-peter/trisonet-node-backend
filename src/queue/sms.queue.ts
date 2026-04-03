import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const smsQueue = new Queue('smsQueue', { connection: redisConnection });

export const addSmsJob = async (phoneNumber: string, message: string) => {
    await smsQueue.add('sendSms', {
        phoneNumber,
        message
    });
};
