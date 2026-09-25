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

export const addOrderConfirmationEmailJob = async (email: string, vars: {
    name: string;
    orderRef: string;
    orderDate: string;
    itemsHtml: string;
    total: string;
    deliveryAddress: string;
}) => {
    await mailQueue.add('sendOrderConfirmationEmail', {
        email,
        vars
    });
};

export const addSellerNewOrderEmailJob = async (email: string, vars: {
    name: string;
    storeName: string;
    orderRef: string;
    itemsHtml: string;
    total: string;
    payout: string;
    buyerName: string;
    buyerPhone: string;
    deliveryAddress: string;
}) => {
    await mailQueue.add('sendSellerNewOrderEmail', {
        email,
        vars
    });
};
