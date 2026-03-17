import { Queue } from 'bullmq';

// Setup Redis options compatible with BullMQ
const connectionOpts = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
};

export const smsQueue = new Queue('smsQueue', { connection: connectionOpts });

export const addSmsJob = async (phoneNumber: string, message: string) => {
    await smsQueue.add('sendSms', {
        phoneNumber,
        message
    });
};
