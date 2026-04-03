import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const referralQueue = new Queue('referralQueue', { connection: redisConnection });

export const addFundReferralsJob = async (userId: bigint, referralId: bigint) => {
    await referralQueue.add('fundReferrals', {
        userId: userId.toString(),
        referralId: referralId.toString()
    });
};
