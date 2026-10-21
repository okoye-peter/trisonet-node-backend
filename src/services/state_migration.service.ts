import { prisma, Prisma } from "../config/prisma.js";
import { ROLES } from "../config/constants.js";
import { AppError } from "../utils/AppError.js";

// The PHP app (timezone Africa/Lagos, UTC+1 with no DST) owns the weekly state migration
// and writes naive Lagos-local timestamps (activated_at, state_weekly_results.week_start).
// Mirror of App\Services\StateMigrationService::weekContaining - keep both in sync.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEDNESDAY = 3;

/**
 * The migration week containing `at`: Wednesday 00:00 to the next Wednesday 00:00, Lagos time.
 *
 * `queryStart`/`queryEnd` carry the Lagos wall-clock time in a UTC Date, because Prisma
 * sends Dates to MySQL as UTC strings and the PHP-written columns hold naive Lagos time.
 * `startsAt`/`endsAt` are the real instants, for display.
 */
export const migrationWeek = (at: Date = new Date()) => {
    const lagosNow = new Date(at.getTime() + LAGOS_OFFSET_MS);
    const daysSinceWednesday = (lagosNow.getUTCDay() - WEDNESDAY + 7) % 7;
    const queryStart = new Date(Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate() - daysSinceWednesday));
    const queryEnd = new Date(queryStart.getTime() + WEEK_MS);

    return {
        queryStart,
        queryEnd,
        startsAt: new Date(queryStart.getTime() - LAGOS_OFFSET_MS),
        endsAt: new Date(queryEnd.getTime() - LAGOS_OFFSET_MS),
    };
};

type UserCountryRef = { id: bigint; stateId: bigint | null; country: string | null; countryId: bigint | null };

const stateSelect = { id: true, name: true, country: { select: { name: true } } } as const;
const toStateDto = (state: { id: bigint; name: string; country: { name: string } | null }) => ({
    id: state.id,
    name: state.name,
    country: state.country?.name ?? null,
});

export default class StateMigrationService {
    /**
     * Resolves a users.country text value to a countries row - by name, or by one of the
     * other spellings (altNames) the PHP forms use, e.g. "Macedonia" for North Macedonia.
     */
    static async resolveCountryId(name: string | null | undefined): Promise<bigint | null> {
        const key = name?.trim();
        if (!key) return null;

        const exact = await prisma.country.findFirst({ where: { name: key }, select: { id: true } });
        if (exact) return exact.id;

        const withAltNames = await prisma.country.findMany({ where: { altNames: { not: Prisma.AnyNull } }, select: { id: true, altNames: true } });
        const lower = key.toLowerCase();
        const match = withAltNames.find((c) => Array.isArray(c.altNames) && c.altNames.some((alt) => String(alt).toLowerCase() === lower));
        return match?.id ?? null;
    }

    static async getStatesByCountry(country: string) {
        const countryId = await this.resolveCountryId(country);
        if (!countryId) return [];

        const states = await prisma.state.findMany({
            where: { countryId },
            select: stateSelect,
            orderBy: { name: "asc" },
        });
        return states.map(toStateDto);
    }

    /**
     * Resolves the state picked at registration. A state is only required when the
     * admin has created states for the user's country.
     */
    static async resolveRegistrationState(stateId: string | null | undefined, countryId: bigint | null) {
        if (!stateId) {
            const hasStates = countryId ? await prisma.state.count({ where: { countryId } }) : 0;
            if (hasStates) throw new AppError("Please select your state", 400);
            return null;
        }

        const state = countryId ? await prisma.state.findFirst({ where: { id: BigInt(stateId), countryId } }) : null;
        if (!state) throw new AppError("The selected state does not belong to the selected country", 400);
        return state.id;
    }

    /** The user's country as a countries row - users.country_id, or resolved from the users.country text. */
    static async userCountryId(user: UserCountryRef) {
        return user.countryId ?? await this.resolveCountryId(user.country);
    }

    /**
     * Lets an existing account without a state pick one, once. After that only the PHP
     * admin can change it. The state must belong to the user's own country.
     */
    static async assignStateToExistingUser(user: UserCountryRef, stateId: string) {
        if (user.stateId) throw new AppError("Your state has already been set. Contact support if it is wrong.", 400);

        const countryId = await this.userCountryId(user);
        const state = countryId
            ? await prisma.state.findFirst({ where: { id: BigInt(stateId), countryId }, select: stateSelect })
            : null;
        if (!state) throw new AppError("The selected state does not belong to your country", 400);

        // stateId: null guard so two parallel requests can't both set it
        const { count } = await prisma.user.updateMany({
            where: { id: user.id, stateId: null },
            data: { stateId: state.id, countryId: user.countryId ?? countryId },
        });
        if (!count) throw new AppError("Your state has already been set. Contact support if it is wrong.", 400);

        return toStateDto(state);
    }

    /**
     * This week's progress for the state the user belongs to.
     */
    static async getProgressForUser(user: UserCountryRef) {
        const week = migrationWeek();
        const base = {
            weekStartsAt: week.startsAt,
            weekEndsAt: week.endsAt,
        };

        // Existing accounts without a state may pick one (once) if their country has states.
        if (!user.stateId) {
            const countryId = await this.userCountryId(user);
            const canSelectState = countryId ? (await prisma.state.count({ where: { countryId } })) > 0 : false;
            return { ...base, state: null, canSelectState };
        }

        const [state, registeredCount, targetSetting, commissionSetting] = await Promise.all([
            prisma.state.findUnique({
                where: { id: user.stateId },
                select: { ...stateSelect, leaderId: true, leader: { select: { name: true } } },
            }),
            prisma.user.count({
                where: {
                    stateId: user.stateId,
                    role: ROLES.CUSTOMER,
                    isInfant: false,
                    status: true,
                    deletedAt: null,
                    activatedAt: { gte: week.queryStart, lt: week.queryEnd },
                },
            }),
            // one target shared by every state - each state works toward it on its own
            prisma.setting.findUnique({ where: { key: "state_weekly_target" } }),
            prisma.setting.findUnique({ where: { key: "state_leader_commission" } }),
        ]);

        if (!state) return { ...base, state: null };

        const target = Math.max(0, Math.floor(Number(targetSetting?.value ?? 0)) || 0);
        const isLeader = state.leaderId === user.id;

        return {
            ...base,
            state: toStateDto(state),
            weeklyTarget: target,
            registeredCount,
            remaining: Math.max(0, target - registeredCount),
            targetReached: target > 0 && registeredCount >= target,
            leaderName: state.leader?.name ?? null,
            isLeader,
            leaderCommission: isLeader ? Number(commissionSetting?.value ?? 0) : null,
        };
    }
}
