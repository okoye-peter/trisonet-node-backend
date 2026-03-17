import { prisma } from "../config/prisma";
import { ROLES } from "../config/constants";
import { WalletType } from "../generated/prisma/enums";
import { addFundReferralsJob } from "../queue/referral.queue";
import { logger } from "../utils/logger";

export class AccountActivationService {
    /**
     * Optimized version of ActivateUserAccount
     */
    static async activateUserAccountOptimized(
        userId: bigint,
        context: { commission?: number; superAdminId?: bigint } = {}
    ) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { wallets: true },
        });

        if (!user) return;

        // Fetch settings or use context
        let commission = context.commission;
        if (commission === undefined) {
            const commissionStr = await prisma.setting.findUnique({ where: { key: 'commission_price' } });
            commission = commissionStr ? parseFloat(commissionStr.value) : 0;
        }

        let superAdminId = context.superAdminId;
        if (superAdminId === undefined) {
            const superAdminObj = await prisma.user.findFirst({
                where: { role: ROLES.SUPER_ADMIN },
                select: { id: true, wallets: true }
            });
            superAdminId = superAdminObj?.id;
        }

        // Handle school compensation
        if (user.isInfant && user.schoolId) {
            const compensation = await prisma.schoolCompensation.findFirst({
                where: { infantId: user.id, isPaid: false }
            });

            if (compensation) {
                const schoolUser = await prisma.user.findUnique({
                    where: { id: user.schoolId },
                    include: { wallets: true }
                });

                if (schoolUser) {
                    const schoolDirectWallet = schoolUser.wallets.find(w => w.type === WalletType.direct);

                    if (schoolDirectWallet) {
                        await prisma.wallet.update({
                            where: { id: schoolDirectWallet.id },
                            data: { amount: { increment: compensation.amount } }
                        });
                    } else {
                        await prisma.wallet.create({
                            data: {
                                userId: user.schoolId,
                                type: WalletType.direct,
                                amount: compensation.amount,
                            }
                        });
                    }

                    await prisma.schoolCompensation.update({
                        where: { id: compensation.id },
                        data: { isPaid: true }
                    });
                }
            }
        }

        // Ensure indirect wallet exists
        let indirectWallet = user.wallets.find(w => w.type === WalletType.indirect);

        if (!indirectWallet) {
            indirectWallet = await prisma.wallet.create({
                data: {
                    userId: user.id,
                    type: WalletType.indirect,
                    amount: 0
                }
            });
            user.wallets.push(indirectWallet); // For subsequent logic
        }

        if (indirectWallet.amount < 1) {
            await prisma.wallet.update({
                where: { id: indirectWallet.id },
                data: { amount: { increment: 1 } }
            });

            // REFERRAL PATH
            if (user.referralId && !user.activatedAt) {
                const referral = await prisma.user.findUnique({
                    where: { id: user.referralId },
                    include: { wallets: true }
                });

                if (referral && !referral.blockedAt) {
                    try {
                        await addFundReferralsJob(user.id, referral.id);
                        logger.info(`[AccountActivationService] FundReferralsJob added for user ${user.id} and referral ${referral.id}`);
                    } catch (e) {
                        logger.error('Adding FundReferralsJob failed:', e);
                    }
                }
            } else {
                let ref = null;
                if (user.regionId) {
                    ref = await prisma.user.findFirst({
                        where: { regionId: user.regionId, role: ROLES.CUSTOMER },
                        orderBy: { createdAt: 'asc' },
                        include: { wallets: true }
                    });
                }

                if (ref && !ref.blockedAt && ref.id !== user.id) {
                    let amountValue = 1;
                    let typeValue: typeof WalletType[keyof typeof WalletType] = WalletType.direct;

                    if (ref.isInfant) {
                        amountValue = 0.1;
                        typeValue = WalletType.indirect;
                    } else {
                        if (ref.country && ref.country.toLowerCase() === "nigeria") {
                            amountValue = commission;
                        } else {
                            amountValue = 1;
                        }
                    }

                    if (ref.wallets.length === 0) {
                        const newDirect = await prisma.wallet.create({ data: { userId: ref.id, type: WalletType.direct, amount: 0 } });
                        const newIndirect = await prisma.wallet.create({ data: { userId: ref.id, type: WalletType.indirect, amount: 0 } });
                        ref.wallets.push(newDirect, newIndirect);
                    }

                    const targetWallet = ref.wallets.find(w => w.type === typeValue);
                    if (targetWallet) {
                        await prisma.wallet.update({
                            where: { id: targetWallet.id },
                            data: { amount: { increment: amountValue } }
                        });
                    }

                    await prisma.user.update({
                        where: { id: ref.id },
                        data: { referralActivateAt: new Date() }
                    });

                    await prisma.user.update({
                        where: { id: user.id },
                        data: { referralId: ref.id }
                    });
                }
            }

            // Influencer logic
            if (user.influencerId && !user.activatedAt) {
                const influencer = await prisma.user.findUnique({
                    where: { id: user.influencerId },
                    include: { wallets: true }
                });

                if (influencer) {
                    if (user.influencerPromoPeriodId) {
                        const promoPeriod = await prisma.influencerPromoPeriod.findUnique({
                            where: { id: user.influencerPromoPeriodId }
                        });

                        if (promoPeriod) {
                            let unitLeader = null;
                            if (influencer.influencerId) {
                                unitLeader = await prisma.user.findUnique({ where: { id: influencer.influencerId } });
                            } else {
                                unitLeader = influencer;
                            }

                            if (unitLeader) {
                                const facilitatorIds = await prisma.user.findMany({
                                    where: { influencerId: unitLeader.id, role: ROLES.INFLUENCER, status: true },
                                    select: { id: true }
                                }).then(f => f.map(u => u.id));

                                const slotCount = await prisma.user.count({
                                    where: {
                                        influencerPromoPeriodId: promoPeriod.id,
                                        createdAt: { gte: promoPeriod.startDate, lte: promoPeriod.endDate },
                                        influencerId: { in: [unitLeader.id, ...facilitatorIds] }
                                    }
                                });

                                if (slotCount >= promoPeriod.target) {
                                    await prisma.user.update({
                                        where: { id: user.id },
                                        data: { influencerPromoPeriodId: null }
                                    });
                                }
                            }
                        }
                    }

                    const infWallet = influencer.wallets.find(w => w.type === WalletType.direct);
                    if (infWallet) {
                        await prisma.wallet.update({
                            where: { id: infWallet.id },
                            data: { amount: { increment: commission } }
                        });
                    }
                }
            }

            // Update user status
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    status: true,
                    canEarn: true,
                    activatedAt: new Date()
                }
            });

            // Give commission to super admin
            if (superAdminId) {
                const superAdmin = await prisma.user.findUnique({
                    where: { id: superAdminId },
                    include: { wallets: true }
                });

                if (superAdmin) {
                    const superDirect = superAdmin.wallets.find(w => w.type === WalletType.direct);
                    if (superDirect) {
                        await prisma.wallet.update({
                            where: { id: superDirect.id },
                            data: { amount: { increment: commission } }
                        });
                    }

                    const superCentral = superAdmin.wallets.find(w => w.type === WalletType.central_treasury);
                    if (superCentral) {
                        await prisma.wallet.update({
                            where: { id: superCentral.id },
                            data: { amount: { increment: 1 } }
                        });
                    }
                }
            }
        }
    }
}
