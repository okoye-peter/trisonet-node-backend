import crypto from "crypto";
import { prisma, Prisma, WalletType } from "../config/prisma.js";
import { ROLES } from "../config/constants.js";
import { getSetting } from "./setting.service.js";
import { AccountActivationService } from "./account_activation.service.js";
import { CommissionLogService } from "./commission_log.service.js";
import { AppError } from "../utils/AppError.js";
import { toPhpWallClock } from "../utils/phpClock.js";

/**
 * Admin acts as a member patron under every patron leader and patron group, from one account.
 *
 * Each leader/group gets a registration link (patron_admin_links.code). A customer who registers
 * through it is paid for from that patron's patronage wallet (gkwth_sale_price), recorded under
 * that patron (users.patron_id), and the admin account's direct wallet earns commission_price.
 *
 * Mirrors app/Services/PatronAdminLinkService.php in the PHP app - keep both in sync.
 */

export const ADMIN_MEMBER_SETTING_KEY = 'patron_admin_member_user_id';
export const ADMIN_LINK_CODE_PREFIX = 'adm_';
export const ADMIN_LINK_PROCESSED_VIA = 'patron_admin_link_registration';

type Client = Prisma.TransactionClient | typeof prisma;

const linkInclude = {
    leader: { select: { id: true, name: true, email: true } },
    patronGroup: { select: { id: true, name: true, owner: { select: { id: true, name: true, email: true } } } },
} as const;

type LinkWithPatron = Prisma.PatronAdminLinkGetPayload<{ include: typeof linkInclude }>;

export interface ResolvedAdminLink {
    linkId: bigint;
    patronLeaderId: bigint | null;
    patronGroupId: bigint | null;
    payingPatronId: bigint;
}

async function numberSetting(key: string, client: Client = prisma): Promise<number> {
    const row = await client.setting.findUnique({ where: { key }, select: { value: true } });
    return row ? parseFloat(row.value) || 0 : 0;
}

function payingPatron(link: LinkWithPatron) {
    return link.patronLeaderId ? link.leader : link.patronGroup?.owner ?? null;
}

function newCode(): string {
    return ADMIN_LINK_CODE_PREFIX + crypto.randomBytes(5).toString('hex');
}

export const ADMIN_LINK_LIMIT_REACHED_ERROR = 'This registration link has reached its limit for now, please try again later';

type RoundFields = { roundSlots: number | null; roundAdminQuota: number; roundAdminUsed: number; roundBaseCount: number };

export interface RoundState {
    /** registrations the admin can still make through the link right now */
    adminSlots: number;
    /** registrations the patron's own members still need to make before the link reopens */
    membersRemaining: number;
    status: 'open' | 'waiting_for_members' | 'needs_funding';
    walletSlots: number;
    roundSlots: number | null;
    adminQuota: number;
    adminUsed: number;
}

function describeRound(round: RoundFields, charged: number) {
    if (round.roundSlots === null) return { adminLeft: 0, membersLeft: 0 };
    const adminLeft = Math.max(0, round.roundAdminQuota - round.roundAdminUsed);
    const membersUsed = Math.max(0, charged - round.roundBaseCount - round.roundAdminUsed);
    const membersLeft = Math.max(0, (round.roundSlots - round.roundAdminQuota) - membersUsed);
    return { adminLeft, membersLeft };
}

export class PatronAdminLinkService {
    static async adminMemberId(): Promise<bigint | null> {
        const value = await getSetting(ADMIN_MEMBER_SETTING_KEY);
        return value && value !== '0' ? BigInt(value) : null;
    }

    static async isAdminMember(userId: bigint | string | number | null | undefined): Promise<boolean> {
        if (userId === null || userId === undefined) return false;
        const adminId = await this.adminMemberId();
        return adminId !== null && adminId === BigInt(userId);
    }

    static isAdminCode(code: string | null | undefined): boolean {
        return typeof code === 'string' && code.trim().toLowerCase().startsWith(ADMIN_LINK_CODE_PREFIX);
    }

    static activationFee(client: Client = prisma): Promise<number> {
        return numberSetting('gkwth_sale_price', client);
    }

    /** How many more customers the patronage balance can pay for. */
    static availableSlots(balance: number, fee: number): number {
        if (fee <= 0) return 0;
        return Math.max(0, Math.floor(balance / fee));
    }

    /** Customers charged to this patron's patronage wallet so far (admin-link and the patron's own). */
    static chargedCount(patronId: bigint, client: Client = prisma): Promise<number> {
        return client.user.count({ where: { patronId } });
    }

    /**
     * The admin may only use half of a patron's slots per round.
     *
     * A round starts with the slots the patronage balance funds (needs at least 2). The admin gets
     * floor(slots / 2); the rest belong to the patron's own registrations. Once the admin has used
     * its half, the link stays locked until the patron's registrations use theirs (or the wallet
     * runs dry), then a new round starts on whatever the balance funds at that point.
     *
     * May start/clear a round on the link, so pass the transaction when the result decides whether
     * a signup goes through. Mirrors PatronAdminLinkService::roundState() in PHP.
     */
    static async roundState(
        link: RoundFields & { id: bigint },
        patronId: bigint,
        balance: number,
        fee: number,
        opts: { charged?: number; client?: Client } = {},
    ): Promise<RoundState> {
        const client = opts.client ?? prisma;
        const walletSlots = this.availableSlots(balance, fee);
        const charged = opts.charged ?? await this.chargedCount(patronId, client);

        let round: RoundFields = {
            roundSlots: link.roundSlots,
            roundAdminQuota: link.roundAdminQuota,
            roundAdminUsed: link.roundAdminUsed,
            roundBaseCount: link.roundBaseCount,
        };
        let current = describeRound(round, charged);
        const roundOver = round.roundSlots === null
            || (current.adminLeft === 0 && (current.membersLeft === 0 || walletSlots === 0));

        if (roundOver) {
            if (walletSlots >= 2) {
                round = { roundSlots: walletSlots, roundAdminQuota: Math.floor(walletSlots / 2), roundAdminUsed: 0, roundBaseCount: charged };
                await client.patronAdminLink.update({ where: { id: link.id }, data: { ...round, roundStartedAt: toPhpWallClock() } });
            } else if (round.roundSlots !== null) {
                round = { roundSlots: null, roundAdminQuota: 0, roundAdminUsed: 0, roundBaseCount: 0 };
                await client.patronAdminLink.update({ where: { id: link.id }, data: { ...round, roundStartedAt: null } });
            }
            current = describeRound(round, charged);
        }

        const adminSlots = Math.min(current.adminLeft, walletSlots);
        const membersRemaining = current.adminLeft > 0 ? 0 : current.membersLeft;

        return {
            adminSlots,
            membersRemaining,
            status: adminSlots > 0 ? 'open' : (membersRemaining > 0 && walletSlots > 0 ? 'waiting_for_members' : 'needs_funding'),
            walletSlots,
            roundSlots: round.roundSlots,
            adminQuota: round.roundAdminQuota,
            adminUsed: round.roundAdminUsed,
        };
    }

    /**
     * Creates any missing links: one per patron group that has an owner, and one per individual
     * top-level patron (no upline, no group). The admin account itself never gets a link.
     */
    static async sync(): Promise<number> {
        const adminId = await this.adminMemberId();
        const existing = await prisma.patronAdminLink.findMany({ select: { patronLeaderId: true, patronGroupId: true } });
        const linkedGroups = new Set(existing.map(l => l.patronGroupId?.toString()).filter(Boolean));
        const linkedLeaders = new Set(existing.map(l => l.patronLeaderId?.toString()).filter(Boolean));

        const [groups, leaders] = await Promise.all([
            prisma.patronGroup.findMany({ where: { userId: { not: null } }, select: { id: true } }),
            prisma.user.findMany({
                where: { role: ROLES.PATRON, patronId: null, patronGroupId: null, ...(adminId ? { id: { not: adminId } } : {}) },
                select: { id: true },
            }),
        ]);

        const data = [
            ...groups.filter(g => !linkedGroups.has(g.id.toString())).map(g => ({ code: newCode(), patronGroupId: g.id })),
            ...leaders.filter(u => !linkedLeaders.has(u.id.toString())).map(u => ({ code: newCode(), patronLeaderId: u.id })),
        ];

        if (data.length === 0) return 0;
        const result = await prisma.patronAdminLink.createMany({ data, skipDuplicates: true });
        return result.count;
    }

    /** The link whose admin member row a patron sees (their own, or their group's). */
    static async linkForPatron(patron: { id: bigint; patronId: bigint | null; patronGroupId: bigint | null }) {
        if (patron.patronGroupId) {
            return prisma.patronAdminLink.findUnique({ where: { patronGroupId: patron.patronGroupId }, include: linkInclude });
        }
        return prisma.patronAdminLink.findUnique({ where: { patronLeaderId: patron.patronId ?? patron.id }, include: linkInclude });
    }

    static async patronageBalance(userId: bigint | null | undefined, client: Client = prisma): Promise<number> {
        if (!userId) return 0;
        const wallet = await client.wallet.findFirst({ where: { userId, type: WalletType.patronage }, select: { amount: true } });
        return Number(wallet?.amount ?? 0);
    }

    /**
     * Resolves a ?ref= code before the user is created. Returns null when the code isn't an
     * admin link code; throws a 400 when it is one but can't be used right now.
     */
    static async resolve(code: string | null | undefined): Promise<ResolvedAdminLink | null> {
        if (!this.isAdminCode(code)) return null;

        const link = await prisma.patronAdminLink.findUnique({
            where: { code: code!.trim().toLowerCase() },
            include: linkInclude,
        });

        if (!link) throw new AppError('Referral ID is invalid', 400);
        if (!link.status) throw new AppError('This registration link has been disabled', 400);
        if (!(await this.adminMemberId())) throw new AppError('This registration link is not available yet, please contact support', 400);

        const patron = payingPatron(link);
        if (!patron) throw new AppError('This registration link is no longer linked to a patron', 400);

        const [fee, balance] = await Promise.all([this.activationFee(), this.patronageBalance(patron.id)]);
        if (balance < fee) {
            throw new AppError('The selected patron has insufficient funds, please contact them to fund their patronage wallet to proceed with registration', 400);
        }

        if ((await this.roundState(link, patron.id, balance, fee)).adminSlots < 1) {
            throw new AppError(ADMIN_LINK_LIMIT_REACHED_ERROR, 400);
        }

        return { linkId: link.id, patronLeaderId: link.patronLeaderId, patronGroupId: link.patronGroupId, payingPatronId: patron.id };
    }

    /**
     * Runs inside the registration transaction, after the user and their wallets exist:
     * charges the patron, activates the user, and pays the admin account.
     */
    static async completeRegistration(resolved: ResolvedAdminLink, userId: bigint, tx: Prisma.TransactionClient): Promise<void> {
        const [fee, commission, adminId] = await Promise.all([
            this.activationFee(tx),
            numberSetting('commission_price', tx),
            this.adminMemberId(),
        ]);

        // Lock the link so two concurrent signups can't both take the admin's last slot of the round.
        // Runs before this user gets patronId, so it isn't counted as one of the patron's own.
        await tx.$queryRaw`SELECT id FROM patron_admin_links WHERE id = ${resolved.linkId} FOR UPDATE`;
        const link = await tx.patronAdminLink.findUniqueOrThrow({ where: { id: resolved.linkId } });
        const balance = await this.patronageBalance(resolved.payingPatronId, tx);
        if ((await this.roundState(link, resolved.payingPatronId, balance, fee, { client: tx })).adminSlots < 1) {
            throw new AppError(ADMIN_LINK_LIMIT_REACHED_ERROR, 400);
        }

        // Conditional decrement so two concurrent signups can't overdraw the wallet.
        const charged = await tx.wallet.updateMany({
            where: { userId: resolved.payingPatronId, type: WalletType.patronage, amount: { gte: fee } },
            data: { amount: { decrement: fee } },
        });
        if (charged.count === 0) {
            throw new AppError('The selected patron has insufficient funds, please contact them to fund their patronage wallet to proceed with registration', 400);
        }

        // Recorded under the top-level patron, who has no upline, so the activation-time
        // patron block logs "skipped" and the commission below is the only one paid.
        await tx.user.update({ where: { id: userId }, data: { patronId: resolved.payingPatronId } });
        await tx.patronAdminLink.update({ where: { id: resolved.linkId }, data: { roundAdminUsed: { increment: 1 } } });

        await AccountActivationService.activateUserAccountOptimized(userId, { tx, source: ADMIN_LINK_PROCESSED_VIA });

        const log = {
            recipientId: adminId,
            sourceUserId: userId,
            type: 'patron' as const,
            amount: commission,
            walletType: WalletType.direct,
            processedVia: ADMIN_LINK_PROCESSED_VIA,
            metadata: {
                patron_admin_link_id: resolved.linkId.toString(),
                patron_leader_id: resolved.patronLeaderId?.toString() ?? null,
                patron_group_id: resolved.patronGroupId?.toString() ?? null,
                paying_patron_id: resolved.payingPatronId.toString(),
                patronage_fee: fee,
            },
            tx,
        };

        const credited = adminId
            ? await tx.wallet.updateMany({ where: { userId: adminId, type: WalletType.direct }, data: { amount: { increment: commission } } })
            : { count: 0 };

        if (credited.count > 0) {
            await CommissionLogService.success({ ...log, reason: 'Admin member commission via patron admin link' });
        } else {
            await CommissionLogService.failed({ ...log, reason: 'Admin member account has no direct wallet' });
        }
    }

    /**
     * Rows for the admin member's links page: link, patron, patronage balance, available slots,
     * customers registered and commission earned through each link.
     */
    static async report() {
        await this.sync();

        const [links, fee, adminId] = await Promise.all([
            prisma.patronAdminLink.findMany({ include: linkInclude, orderBy: { id: 'asc' } }),
            this.activationFee(),
            this.adminMemberId(),
        ]);

        const payerIds = [...new Set(links.map(l => payingPatron(l)?.id).filter((id): id is bigint => !!id))];

        const [wallets, chargedGroups, logs] = await Promise.all([
            prisma.wallet.findMany({ where: { userId: { in: payerIds }, type: WalletType.patronage }, select: { userId: true, amount: true } }),
            prisma.user.groupBy({ by: ['patronId'], where: { patronId: { in: payerIds } }, _count: { _all: true } }),
            adminId
                ? prisma.commissionLog.findMany({
                    where: { recipientId: adminId, processedVia: ADMIN_LINK_PROCESSED_VIA, status: 'success' },
                    select: { amount: true, metadata: true },
                })
                : Promise.resolve([]),
        ]);

        const balances = new Map(wallets.map(w => [w.userId.toString(), Number(w.amount)]));
        const stats = new Map<string, { registered: number; earned: number }>();
        for (const log of logs) {
            const linkId = String((log.metadata as any)?.patron_admin_link_id ?? '');
            const entry = stats.get(linkId) ?? { registered: 0, earned: 0 };
            entry.registered += 1;
            entry.earned += Number(log.amount ?? 0);
            stats.set(linkId, entry);
        }

        const charged = new Map(chargedGroups.map(g => [String(g.patronId), g._count._all]));
        const noRound: RoundState = { adminSlots: 0, membersRemaining: 0, status: 'needs_funding', walletSlots: 0, roundSlots: null, adminQuota: 0, adminUsed: 0 };

        const rows = await Promise.all(links.map(async link => {
            const patron = payingPatron(link);
            const balance = patron ? balances.get(patron.id.toString()) ?? 0 : 0;
            const stat = stats.get(link.id.toString()) ?? { registered: 0, earned: 0 };
            const round = patron
                ? await this.roundState(link, patron.id, balance, fee, { charged: charged.get(patron.id.toString()) ?? 0 })
                : noRound;
            return {
                id: link.id.toString(),
                code: link.code,
                active: link.status,
                type: link.patronGroupId ? 'group' : 'individual',
                name: link.patronGroupId ? link.patronGroup?.name ?? `Group #${link.patronGroupId}` : link.leader?.name ?? `Patron #${link.patronLeaderId}`,
                patron: patron ? { id: patron.id.toString(), name: patron.name, email: patron.email } : null,
                patronageBalance: balance,
                // the admin's remaining share this round, not the whole wallet
                availableSlots: round.adminSlots,
                round,
                registered: stat.registered,
                earned: stat.earned,
            };
        }));

        return {
            activationFee: fee,
            totals: {
                availableSlots: rows.filter(r => r.active).reduce((a, r) => a + r.availableSlots, 0),
                registered: rows.reduce((a, r) => a + r.registered, 0),
                earned: rows.reduce((a, r) => a + r.earned, 0),
            },
            links: rows,
        };
    }
}
