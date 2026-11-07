import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { redis } from "../utils/cache";
import { AppError } from "../utils/AppError";
import { ROLES, PHP_HOSTED_ROLES } from "../config/constants";
import { signAccessToken, signRefreshToken } from "../utils/jwt";
import { addSmsJob } from "../queue/sms.queue";
import { addOtpEmailJob } from "../queue/mail.queue";
import { logger } from "../utils/logger";
import { toPhpWallClock } from "../utils/phpClock";

/**
 * Account switching. Accounts owned by the same person share a `linked_accounts.group_key`;
 * any member can switch to any other member without re-entering credentials.
 *
 * Only the main (adult customer) account (A) can start a link; other members can only switch.
 * Any non-admin account can be linked; user-facing text calls them all "partner accounts".
 * Linking account B from a session on account A requires proof of owning B:
 *   - B's username/email + B's password, then a one-time code sent to B's phone and email; or
 *   - for sponsors (who log in with email + OTP in the PHP app and have no real password):
 *     B's email, then the one-time code.
 * The pending OTP lives in Redis, keyed by A, so nothing is written to `users`.
 *
 * Sponsors and influencers are hosted by the PHP app, so switching to one hands the session over through
 * `auth_handoff_tokens` (consumed by PHP's GET /handoff). The PHP side of this feature is
 * App\Services\LinkedAccountService — keep the two in sync.
 */

// Every account type except admins (super admin, admin, infant admin) can be linked as a "partner account".
// Admins are excluded so a compromised session can never become a path into an admin account.
// Store guests are throwaway shop-checkout accounts, not real partner accounts, so they're left out too.
export const LINKABLE_ROLES: number[] = [ROLES.CUSTOMER, ROLES.INFLUENCER, ROLES.SPONSOR, ROLES.PATRON, ROLES.SCHOOL];

// New links can only be started from the main (adult customer) account. Every other linked account can
// still switch around the group (and back), but cannot add accounts to it.
export const LINK_INITIATOR_ROLES: number[] = [ROLES.CUSTOMER];
const ADULT_ONLY_MESSAGE = "Partner accounts can only be linked from your main partner account. Switch to it to link another partner account.";

// Roles whose dashboard lives in the PHP app; switching to one goes through PHP's /handoff.
const SWITCH_VIA_PHP_ROLES: number[] = [...PHP_HOSTED_ROLES, ROLES.SCHOOL];

const assertCanInitiateLink = async (requesterId: bigint) => {
    const requester = await prisma.user.findUnique({
        where: { id: requesterId },
        select: { role: true, isInfant: true, deletedAt: true },
    });
    if (!requester || requester.deletedAt || requester.isInfant || !LINK_INITIATOR_ROLES.includes(Number(requester.role))) {
        throw new AppError(ADULT_ONLY_MESSAGE, 403);
    }
};

const PHP_APP_URL = (process.env.PHP_APP_URL || "https://app.trisonet.com").replace(/\/+$/, "");
const HANDOFF_TTL_MS = 2 * 60 * 1000;

const MAX_GROUP_SIZE = 10;
const OTP_TTL_SECONDS = 10 * 60;
const MAX_OTP_ATTEMPTS = 5;

const otpKey = (requesterId: bigint) => `account-link:otp:${requesterId}`;
const hashOtp = (otp: string) => crypto.createHash("sha256").update(otp).digest("hex");

type PendingLink = { targetId: string; otpHash: string; attempts: number };

const ROLE_LABELS: Record<number, string> = {
    [ROLES.CUSTOMER]: "Partner",
    [ROLES.INFLUENCER]: "Coordinator",
    [ROLES.SPONSOR]: "Sponsor",
    [ROLES.PATRON]: "Patron",
    [ROLES.SCHOOL]: "School",
};

const linkedUserSelect = {
    id: true,
    name: true,
    username: true,
    email: true,
    role: true,
    pictureUrl: true,
    isInfant: true,
    deletedAt: true,
} as const;

const toPublicAccount = (u: { id: bigint; name: string; username: string | null; email: string | null; role: number; pictureUrl: string | null }, currentUserId: bigint) => ({
    id: u.id.toString(),
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role] ?? "Account",
    pictureUrl: u.pictureUrl,
    isCurrent: u.id === currentUserId,
});

const isUsableAccount = (u: { role: number; isInfant: boolean; deletedAt: Date | null }) =>
    !u.deletedAt && !u.isInfant && LINKABLE_ROLES.includes(Number(u.role));

const maskPhone = (phone: string) =>
    phone.length <= 6 ? "****" : `${phone.slice(0, 4)}****${phone.slice(-3)}`;

const maskEmail = (email: string) => {
    const [local, domain] = email.split("@");
    if (!local || !domain) return "****";
    return `${local.slice(0, 2)}***@${domain}`;
};

const getGroupKey = async (userId: bigint) =>
    (await prisma.linkedAccount.findUnique({ where: { userId }, select: { groupKey: true } }))?.groupKey ?? null;

/** All accounts in the user's group (including the user), or just the user when unlinked. */
export const listLinkedAccounts = async (userId: bigint) => {
    const groupKey = await getGroupKey(userId);
    if (!groupKey) return [];

    const rows = await prisma.linkedAccount.findMany({
        where: { groupKey },
        orderBy: { createdAt: "asc" },
        select: { user: { select: linkedUserSelect } },
    });

    return rows
        .map((r) => r.user)
        .filter(isUsableAccount)
        .map((u) => toPublicAccount(u, userId));
};

/** Step 1: check the target's credentials and send it an OTP. */
export const requestLink = async (requester: { id: bigint; role: number }, identifier: string, password?: string) => {
    await assertCanInitiateLink(requester.id);

    const trimmed = identifier.trim();
    // usernames are not unique (see users.username), so check the password against every match
    const candidates = await prisma.user.findMany({
        where: {
            deletedAt: null,
            isInfant: false,
            OR: [{ email: trimmed }, { username: trimmed }],
        },
        select: { ...linkedUserSelect, password: true, phone: true },
        take: 20,
    });

    const matches: typeof candidates = [];
    if (password) {
        for (const c of candidates) {
            if (c.role !== ROLES.SPONSOR && (await bcrypt.compare(password, c.password))) matches.push(c);
        }
    }
    if (matches.length > 1) {
        throw new AppError("More than one account uses that username. Enter the partner account's email address instead.", 409);
    }

    let target = matches[0];
    if (!target) {
        // Sponsors log in with email + OTP only, so the OTP alone proves ownership.
        const sponsors = candidates.filter((c) => c.role === ROLES.SPONSOR && c.email?.toLowerCase() === trimmed.toLowerCase());
        if (sponsors.length === 1) target = sponsors[0];
    }
    if (!target) {
        throw new AppError("Incorrect username/email or password for the partner account you want to link. For a sponsor account, enter the sponsor email and leave the password empty.", 401);
    }

    if (target.id === requester.id) {
        throw new AppError("You are already logged in to this account. Enter the details of a different partner account.", 400);
    }
    if (!LINKABLE_ROLES.includes(Number(target.role))) {
        throw new AppError("Admin and store guest accounts cannot be linked as partner accounts.", 403);
    }

    const [requesterGroup, targetGroup] = await Promise.all([getGroupKey(requester.id), getGroupKey(target.id)]);
    if (requesterGroup && requesterGroup === targetGroup) {
        throw new AppError("This partner account is already linked to yours.", 400);
    }
    const [requesterCount, targetCount] = await Promise.all([
        requesterGroup ? prisma.linkedAccount.count({ where: { groupKey: requesterGroup } }) : 1,
        targetGroup ? prisma.linkedAccount.count({ where: { groupKey: targetGroup } }) : 1,
    ]);
    if (requesterCount + targetCount > MAX_GROUP_SIZE) {
        throw new AppError(`You can link at most ${MAX_GROUP_SIZE} partner accounts together. Unlink one to add another.`, 400);
    }

    // Send to every contact the account has (like sponsor login) so one failed channel doesn't block linking.
    const phone = target.phone ?? "";
    const email = target.email ?? "";
    if (!phone && !email) {
        throw new AppError("That partner account has no phone number or email to send a verification code to. Add one to that account first, then try again.", 400);
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const pending: PendingLink = { targetId: target.id.toString(), otpHash: hashOtp(otp), attempts: 0 };
    await redis.set(otpKey(requester.id), JSON.stringify(pending), "EX", OTP_TTL_SECONDS);

    if (process.env.NODE_ENV === "production") {
        if (phone) {
            await addSmsJob(phone, `Your TrisoNet code to link partner account ${target.username ?? target.name} is ${otp}. It expires in 10 minutes. Do not share it.`);
        }
        if (email) {
            await addOtpEmailJob(email, otp);
        }
    } else {
        logger.info(`[account-link] dev OTP for linking user ${target.id} to ${requester.id}: ${otp}`);
    }

    const destination = [phone ? `phone ${maskPhone(phone)}` : null, email ? `email ${maskEmail(email)}` : null]
        .filter(Boolean)
        .join(" and ");

    return {
        destination,
        account: toPublicAccount(target, requester.id),
    };
};

/** Step 2: verify the OTP and put both accounts in the same group (merging groups if needed). */
export const verifyLink = async (requesterId: bigint, otp: string) => {
    await assertCanInitiateLink(requesterId);

    const key = otpKey(requesterId);
    const raw = await redis.get(key);
    if (!raw) {
        throw new AppError("The verification code has expired. Please start again to get a new code.", 400);
    }

    const pending = JSON.parse(raw) as PendingLink;
    if (hashOtp(otp) !== pending.otpHash) {
        pending.attempts += 1;
        if (pending.attempts >= MAX_OTP_ATTEMPTS) {
            await redis.del(key);
            throw new AppError("Too many wrong codes. Please start again.", 400);
        }
        const ttl = await redis.ttl(key);
        await redis.set(key, JSON.stringify(pending), "EX", ttl > 0 ? ttl : OTP_TTL_SECONDS);
        throw new AppError("Incorrect verification code. Check the code sent to the partner account and try again.", 400);
    }
    await redis.del(key);

    const targetId = BigInt(pending.targetId);
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: linkedUserSelect });
    if (!target || !isUsableAccount(target)) {
        throw new AppError("That partner account can no longer be linked. Please start again.", 400);
    }

    await prisma.$transaction(async (tx) => {
        const [mine, theirs] = await Promise.all([
            tx.linkedAccount.findUnique({ where: { userId: requesterId } }),
            tx.linkedAccount.findUnique({ where: { userId: targetId } }),
        ]);

        if (mine && theirs) {
            if (mine.groupKey !== theirs.groupKey) {
                await tx.linkedAccount.updateMany({ where: { groupKey: theirs.groupKey }, data: { groupKey: mine.groupKey } });
            }
            return;
        }
        if (mine) {
            await tx.linkedAccount.create({ data: { groupKey: mine.groupKey, userId: targetId } });
            return;
        }
        if (theirs) {
            await tx.linkedAccount.create({ data: { groupKey: theirs.groupKey, userId: requesterId } });
            return;
        }
        const groupKey = crypto.randomUUID();
        await tx.linkedAccount.createMany({
            data: [
                { groupKey, userId: requesterId },
                { groupKey, userId: targetId },
            ],
        });
    });

    return listLinkedAccounts(requesterId);
};

/** Remove an account (or yourself) from the group. A group left with one member is dissolved. */
export const unlinkAccount = async (requesterId: bigint, targetId: bigint) => {
    const groupKey = await getGroupKey(requesterId);
    if (!groupKey || (await getGroupKey(targetId)) !== groupKey) {
        throw new AppError("That partner account is not linked to yours.", 404);
    }

    await prisma.$transaction(async (tx) => {
        await tx.linkedAccount.delete({ where: { userId: targetId } });
        const remaining = await tx.linkedAccount.count({ where: { groupKey } });
        if (remaining < 2) {
            await tx.linkedAccount.deleteMany({ where: { groupKey } });
        }
    });

    return listLinkedAccounts(requesterId);
};

/** Issue a fresh session for a linked account. */
export const switchToAccount = async (requesterId: bigint, targetId: bigint) => {
    if (requesterId === targetId) {
        throw new AppError("You are already using this partner account.", 400);
    }

    const groupKey = await getGroupKey(requesterId);
    if (!groupKey || (await getGroupKey(targetId)) !== groupKey) {
        throw new AppError("That partner account is not linked to yours.", 403);
    }

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: linkedUserSelect });
    if (!target || !isUsableAccount(target)) {
        throw new AppError("That partner account is no longer available.", 404);
    }

    logger.info(`[account-link] user ${requesterId} switched to linked account ${targetId}`);

    if (SWITCH_VIA_PHP_ROLES.includes(Number(target.role))) {
        // Same token format as PHP's AuthHandoffService: random 64-hex token, stored sha256-hashed, 2 min TTL.
        // Timestamps are written on PHP's clock because PHP compares expires_at with its own now().
        const token = crypto.randomBytes(32).toString("hex");
        const now = toPhpWallClock();
        await prisma.$transaction([
            prisma.authHandoffToken.deleteMany({ where: { userId: target.id } }),
            prisma.authHandoffToken.create({
                data: {
                    userId: target.id,
                    token: crypto.createHash("sha256").update(token).digest("hex"),
                    expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
                    createdAt: now,
                    updatedAt: now,
                },
            }),
        ]);
        return {
            user: toPublicAccount(target, target.id),
            redirectUrl: `${PHP_APP_URL}/handoff?token=${token}`,
        };
    }

    const accessToken = signAccessToken(target.id.toString());
    const refreshToken = signRefreshToken(target.id.toString());
    await prisma.user.update({ where: { id: target.id }, data: { refreshToken } });

    return {
        user: toPublicAccount(target, target.id),
        accessToken,
        refreshToken,
    };
};
