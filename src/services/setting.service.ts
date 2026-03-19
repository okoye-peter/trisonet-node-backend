import { prisma } from "../config/prisma";

// ─── Settings Cache ───────────────────────────────────────────────────────────
const settingsCache = new Map<string, { value: string; expiresAt: number }>();

export async function getSetting(key: string, ttlMs = 60_000): Promise<string | null> {
    const cached = settingsCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const setting = await prisma.setting.findFirst({
        where: { key },
        select: { value: true }
    });

    if (setting?.value) {
        settingsCache.set(key, { value: setting.value, expiresAt: Date.now() + ttlMs });
    }

    return setting?.value ?? null;
}