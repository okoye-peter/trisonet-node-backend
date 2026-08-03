import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const referralQueue = new Queue('referralQueue', { connection: redisConnection });

export const addFundReferralsJob = async (userId: bigint, referralId: bigint, source?: string | null, reference?: string | null) => {
    await referralQueue.add('fundReferrals', {
        userId: userId.toString(),
        referralId: referralId.toString(),
        source: source ?? null,
        reference: reference ?? null,
    });
};
