
export const redisConnection = {
    // url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD, 
    maxRetriesPerRequest: null,
};
