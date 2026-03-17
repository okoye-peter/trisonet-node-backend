import { prisma } from "../config/prisma";
import { ROLES } from "../config/constants";

interface ReferralResult {
    referralId: bigint | null;
    influencerId: bigint | null;
    influencerPromoPeriodId: bigint | null;
}

/**
 * Handles referral logic during user registration.
 * Resolves referral_id to the appropriate user and sets influencer-related fields if applicable.
 */
export async function handleReferral(
    referralId: string | null | undefined,
    regionId: string,
    accountType?: string,
    customerRole?: number
): Promise<ReferralResult> {
    const result: ReferralResult = {
        referralId: null,
        influencerId: null,
        influencerPromoPeriodId: null,
    };

    if (referralId) {
        const ref = await prisma.user.findFirst({ where: { username: referralId } });
        if (!ref) return result;

        // Referral is a customer
        if (ref.role === ROLES.CUSTOMER) {
            result.referralId = ref.id;
            return result;
        }

        // Referral is an influencer
        if (ref.role === ROLES.INFLUENCER) {
            result.influencerId = ref.id;

            // Find the default referral user
            const defaultQuery: Record<string, unknown> = { email: 'triunejobs@gmail.com' };
            if (customerRole) defaultQuery.role = customerRole;

            const defaultUser = await prisma.user.findFirst({
                where: defaultQuery,
                select: { id: true },
            });
            result.referralId = defaultUser?.id ?? null;

            // Determine the unit leader
            const unitLeader = ref.influencerId
                ? await prisma.user.findUnique({ where: { id: ref.influencerId } })
                : ref;

            if (unitLeader) {
                const today = new Date();

                const promo = await prisma.influencerPromoPeriod.findFirst({
                    where: {
                        startDate: { lte: today },
                        endDate: { gte: today },
                    },
                });

                if (promo) {
                    // Get facilitator IDs (influencers under the unit leader)
                    const facilitatorIds = unitLeader.influencerId === null && unitLeader.role === ROLES.INFLUENCER
                        ? (await prisma.user.findMany({
                            where: { influencerId: unitLeader.id, role: ROLES.INFLUENCER, status: true },
                            select: { id: true },
                        })).map(f => f.id)
                        : [];

                    // Count users under unit leader + facilitators within the promo period
                    const count = await prisma.user.count({
                        where: {
                            role: ROLES.CUSTOMER,
                            status: true,
                            influencerPromoPeriodId: promo.id,
                            createdAt: { gte: promo.startDate, lte: promo.endDate },
                            influencerId: {
                                in: [unitLeader.id, ...facilitatorIds],
                            },
                        },
                    });

                    if (count < promo.target) {
                        result.influencerPromoPeriodId = promo.id;
                    }
                }
            }

            return result;
        }

        // Referral is neither customer nor influencer
        return result;
    }

    // No referral_id: for adult customers, fall back to oldest user in the region
    if (accountType === 'adult' && customerRole) {
        const fallback = await prisma.user.findFirst({
            where: { regionId: BigInt(regionId), role: customerRole },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });
        result.referralId = fallback?.id ?? null;
    }

    return result;
}
