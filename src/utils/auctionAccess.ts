import { prisma } from "../config/prisma";

/**
 * Temporary test-rollout gate: while the GKWTH auction feature is being tested live,
 * only user IDs listed in this setting can access it at all. Remove this check (and
 * the setting row) once the feature is opened up to everyone.
 */
export const AUCTION_ALLOWLIST_SETTING_KEY = "auction_allowed_user_ids";

export async function isAuctionAllowedUser(userId: bigint): Promise<boolean> {
    const setting = await prisma.setting.findUnique({ where: { key: AUCTION_ALLOWLIST_SETTING_KEY } });
    if (!setting?.value) return false;

    const allowedIds = setting.value.split(",").map((id) => id.trim()).filter(Boolean);
    return allowedIds.includes(userId.toString());
}
