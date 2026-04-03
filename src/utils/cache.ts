import { Redis } from "ioredis";
import { redisConnection } from "../config/redis";

export const redis = new Redis(redisConnection)

export const getOrSetCache = async <T>(key: string, ttl: number, cb: () => Promise<T>): Promise<T> => {
    const cachedValue = await redis.get(key)
    if (cachedValue) {
        return JSON.parse(cachedValue) as T
    }
    const result = await cb()
    await redis.set(key, JSON.stringify(result), 'EX', ttl)
    return result
}