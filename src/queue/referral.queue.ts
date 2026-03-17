import { Queue } from 'bullmq';
import Redis from 'ioredis';

// Setup Redis options compatible with BullMQ
const connectionOpts = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
};

export const referralQueue = new Queue('referralQueue', { connection: connectionOpts });

export const addFundReferralsJob = async (userId: bigint, referralId: bigint) => {
    await referralQueue.add('fundReferrals', {
        userId: userId.toString(),
        referralId: referralId.toString()
    });
};
