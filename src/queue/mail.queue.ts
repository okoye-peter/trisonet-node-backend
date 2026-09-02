import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const mailQueue = new Queue('mailQueue', { connection: redisConnection });

export const addWelcomeEmailJob = async (email: string, name: string, password: string, intro: string) => {
    await mailQueue.add('sendWelcomeEmail', {
        email,
        name,
        password,
        intro
    });
};

export const addOtpEmailJob = async (email: string, code: string) => {
    await mailQueue.add('sendOtpEmail', {
        email,
        code
    });
};

export const addPukEmailJob = async (email: string, code: string) => {
    await mailQueue.add('sendPukEmail', {
        email,
        code
    });
};
