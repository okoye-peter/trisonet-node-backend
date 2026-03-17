import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_HOST || 'localhost')

export const getOrSetCache = async <T>(key: string, ttl: number, cb: () => Promise<T>): Promise<T> => {
    const cachedValue = await redis.get(key)
    if (cachedValue) {
        return JSON.parse(cachedValue) as T
    }
    const result = await cb()
    await redis.set(key, JSON.stringify(result), 'EX', ttl)
    return result
}