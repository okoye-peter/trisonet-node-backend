import { prisma, WalletType } from "../config/prisma.js";
import { ROLES } from "../config/constants.js";
import { addFundReferralsJob } from "../queue/referral.queue";
import { logger } from "../utils/logger";
import { CommissionLogService } from "./commission_log.service.js";

export class AccountActivationService {
    /**
     * Full activation payment flow: validates the request, updates DB in a transaction,
     * then runs the optimized per-user activation for the primary user and all teammates.
     */
    static async processActivationPayment(reference: string, amountPaid: number, source: string = 'paga_webhook'): Promise<{ status: string }> {
        const activationRequest = await prisma.userActivationRequest.findUnique({
            where: { reference },
            include: {
                user: true,
                activationTeamMates: { include: { user: true } }
            }
        });

        if (!activationRequest) {
            logger.error(`Activation request not found for ref: ${reference}`);
            return { status: 'not_found' };
        }

        if (amountPaid && Number(activationRequest.amount) > amountPaid) {
            logger.error(`Activation amount mismatch. Expected: ${activationRequest.amount}, Paid: ${amountPaid}`);
            return { status: 'amount_mismatch' };
        }

        if (activationRequest.status === 'approved') {
            return { status: 'already_processed' };
        }

        const teammateUserIds: bigint[] = (activationRequest.activationTeamMates ?? []).map((t: any) => t.userId);
        const recipientIds = Array.from(new Set([activationRequest.userId, ...teammateUserIds]));

        await prisma.$transaction(async (tx: any) => {
            await tx.userActivationRequest.update({
                where: { id: activationRequest.id },
                data: { status: 'approved', confirmedAt: new Date() }
            });

            for (const id of recipientIds) {
                await tx.user.update({ where: { id }, data: { accountState: 1 } });
            }

            const notification = await tx.notification.create({
                data: {
                    title: 'Activation Request',
                    body: 'Hello, this is to inform you that your application for activation of account has been approved',
                }
            });

            for (const recipientId of recipientIds) {
                await tx.notificationUser.create({
                    data: { userId: recipientId, notificationId: notification.id }
                });
            }

            logger.info(`Activation DB updated for user: ${activationRequest.userId}, teammates: ${teammateUserIds.length}, ref: ${reference}`);
        });

        // Run outside the transaction to avoid lock contention
        for (const recipientId of recipientIds) {
            await AccountActivationService.activateUserAccountOptimized(recipientId, { source, reference });
        }

        return { status: 'ok' };
    }

    /**
     * Optimized version of ActivateUserAccount
     */
    static async activateUserAccountOptimized(
        userId: bigint,
        context: { commission?: number; superAdminId?: bigint; tx?: any; source?: string; reference?: string } = {}
    ) {
        const source = context.source ?? 'unknown';
        const reference = context.reference ?? null;
        const processedVia = source;
        const client = context.tx || prisma;
        const user = await client.user.findUnique({
            where: { id: userId },
            include: { wallets: true },
        });

        if (!user) return;

        // Fetch settings or use context
        let commission = context.commission;
        if (commission === undefined) {
            const commissionStr = await client.setting.findUnique({ where: { key: 'commission_price' } });
            commission = commissionStr ? parseFloat(commissionStr.value) : 0;
        }

        let superAdminId = context.superAdminId;
        if (superAdminId === undefined) {
            const superAdminObj = await client.user.findFirst({
                where: { role: ROLES.SUPER_ADMIN },
                select: { id: true, wallets: true }
            });
            superAdminId = superAdminObj?.id;
        }

        // Handle school compensation
        if (user.isInfant && user.schoolId) {
            const compensation = await client.schoolCompensation.findFirst({
                where: { infantId: user.id, isPaid: false }
            });

            if (compensation) {
                const schoolUser = await client.user.findUnique({
                    where: { id: user.schoolId },
                    include: { wallets: true }
                });

                if (schoolUser) {
                    const schoolDirectWallet = schoolUser.wallets.find((w: any) => w.type === WalletType.direct);

                    if (schoolDirectWallet) {
                        await client.wallet.update({
                            where: { id: schoolDirectWallet.id },
                            data: { amount: { increment: compensation.amount } }
                        });
                    } else {
                        await client.wallet.create({
                            data: {
                                userId: user.schoolId,
                                type: WalletType.direct,
                                amount: compensation.amount,
                            }
                        });
                    }

                    await client.schoolCompensation.update({
                        where: { id: compensation.id },
                        data: { isPaid: true }
                    });

                    await CommissionLogService.success({
                        recipientId: user.schoolId,
                        sourceUserId: user.id,
                        type: 'school_compensation',
                        amount: Number(compensation.amount),
                        walletType: WalletType.direct,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                } else {
                    await CommissionLogService.failed({
                        recipientId: user.schoolId,
                        sourceUserId: user.id,
                        type: 'school_compensation',
                        amount: Number(compensation.amount),
                        reason: `School user ${user.schoolId} record not found`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                }
            }
        }

        // Ensure indirect wallet exists
        let indirectWallet = user.wallets.find((w: any) => w.type === WalletType.indirect);

        if (!indirectWallet) {
            indirectWallet = await client.wallet.create({
                data: {
                    userId: user.id,
                    type: WalletType.indirect,
                    amount: 0
                }
            });
            user.wallets.push(indirectWallet); // For subsequent logic
        }

        if (user.activatedAt) {
            await CommissionLogService.skipped({
                recipientId: user.referralId ?? null,
                sourceUserId: user.id,
                type: 'direct_referral',
                reason: `User ${user.id} was already activated at ${user.activatedAt.toISOString()} - no commission processed for this activation call (check for an earlier commission log using source_user_id=${user.id})`,
                reference,
                processedVia,
                tx: context.tx,
            });
        }

        if (!user.activatedAt) {
            if (indirectWallet.amount < 1) {
                await client.wallet.update({
                    where: { id: indirectWallet.id },
                    data: { amount: { increment: 1 } }
                });
            }

            // REFERRAL PATH
            if (user.referralId && !user.activatedAt) {
                const referral = await client.user.findUnique({
                    where: { id: user.referralId },
                    include: { wallets: true }
                });

                if (!referral) {
                    await CommissionLogService.failed({
                        recipientId: user.referralId,
                        sourceUserId: user.id,
                        type: 'direct_referral',
                        reason: `Referrer ${user.referralId} record not found (deleted or invalid referral_id)`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                } else if (referral.blockedAt) {
                    await CommissionLogService.skipped({
                        recipientId: referral.id,
                        sourceUserId: user.id,
                        type: 'direct_referral',
                        reason: `Referrer account has been blocked since ${referral.blockedAt.toISOString()}`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                } else {
                    try {
                        await addFundReferralsJob(user.id, referral.id, source, reference);
                        logger.info(`[AccountActivationService] FundReferralsJob added for user ${user.id} and referral ${referral.id}`);
                    } catch (e) {
                        logger.error('Adding FundReferralsJob failed:', e);
                        await CommissionLogService.failed({
                            recipientId: referral.id,
                            sourceUserId: user.id,
                            type: 'direct_referral',
                            reason: `Failed to queue commission job: ${e instanceof Error ? e.message : String(e)}`,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    }
                }
            } else {
                let ref = null;
                if (user.regionId) {
                    ref = await client.user.findFirst({
                        where: { regionId: user.regionId, role: ROLES.CUSTOMER },
                        orderBy: { createdAt: 'asc' },
                        include: { wallets: true }
                    });
                }

                if (ref && ref.blockedAt) {
                    await CommissionLogService.skipped({
                        recipientId: ref.id,
                        sourceUserId: user.id,
                        type: 'region_fallback',
                        reason: `Fallback region referrer account has been blocked since ${ref.blockedAt.toISOString()}`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                } else if (ref && ref.id !== user.id) {
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
                        const newDirect = await client.wallet.create({ data: { userId: ref.id, type: WalletType.direct, amount: 0 } });
                        const newIndirect = await client.wallet.create({ data: { userId: ref.id, type: WalletType.indirect, amount: 0 } });
                        ref.wallets.push(newDirect, newIndirect);
                    }

                    const targetWallet = ref.wallets.find((w: any) => w.type === typeValue);
                    if (targetWallet) {
                        await client.wallet.update({
                            where: { id: targetWallet.id },
                            data: { amount: { increment: amountValue } }
                        });

                        await CommissionLogService.success({
                            recipientId: ref.id,
                            sourceUserId: user.id,
                            type: 'region_fallback',
                            amount: amountValue,
                            walletType: typeValue,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    } else {
                        await CommissionLogService.failed({
                            recipientId: ref.id,
                            sourceUserId: user.id,
                            type: 'region_fallback',
                            amount: amountValue,
                            walletType: typeValue,
                            reason: `No ${typeValue} wallet exists for this recipient to credit`,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    }

                    await client.user.update({
                        where: { id: ref.id },
                        data: { referralActivateAt: new Date() }
                    });

                    await client.user.update({
                        where: { id: user.id },
                        data: { referralId: ref.id }
                    });
                }
            }

            // Influencer logic
            if (user.influencerId && !user.activatedAt) {
                const influencer = await client.user.findUnique({
                    where: { id: user.influencerId },
                    include: { wallets: true }
                });

                if (!influencer) {
                    await CommissionLogService.failed({
                        recipientId: user.influencerId,
                        sourceUserId: user.id,
                        type: 'influencer',
                        amount: commission,
                        reason: `Influencer ${user.influencerId} record not found`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                }

                if (influencer) {
                    if (user.influencerPromoPeriodId) {
                        const promoPeriod = await client.influencerPromoPeriod.findUnique({
                            where: { id: user.influencerPromoPeriodId }
                        });

                        if (promoPeriod) {
                            let unitLeader = null;
                            if (influencer.influencerId) {
                                unitLeader = await client.user.findUnique({ where: { id: influencer.influencerId } });
                            } else {
                                unitLeader = influencer;
                            }

                            if (unitLeader) {
                                const facilitatorIds = await client.user.findMany({
                                    where: { influencerId: unitLeader.id, role: ROLES.INFLUENCER, status: true },
                                    select: { id: true }
                                }).then((f: any) => f.map((u: any) => u.id));

                                const slotCount = await client.user.count({
                                    where: {
                                        influencerPromoPeriodId: promoPeriod.id,
                                        createdAt: { gte: promoPeriod.startDate, lte: promoPeriod.endDate },
                                        influencerId: { in: [unitLeader.id, ...facilitatorIds] }
                                    }
                                });

                                if (slotCount >= promoPeriod.target) {
                                    await client.user.update({
                                        where: { id: user.id },
                                        data: { influencerPromoPeriodId: null }
                                    });
                                }
                            }
                        }
                    }

                    const infWallet = influencer.wallets.find((w: any) => w.type === WalletType.direct);
                    if (infWallet) {
                        await client.wallet.update({
                            where: { id: infWallet.id },
                            data: { amount: { increment: commission } }
                        });

                        await CommissionLogService.success({
                            recipientId: influencer.id,
                            sourceUserId: user.id,
                            type: 'influencer',
                            amount: commission,
                            walletType: WalletType.direct,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    } else {
                        await CommissionLogService.failed({
                            recipientId: influencer.id,
                            sourceUserId: user.id,
                            type: 'influencer',
                            amount: commission,
                            walletType: WalletType.direct,
                            reason: `No direct wallet exists for this influencer to credit`,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    }
                }
            }

            // patron commission
            if (user.patronId && !user.activatedAt) {
                const patron = await client.user.findUnique({
                    where: { id: user.patronId },
                    include: { wallets: true }
                });

                if (!patron) {
                    await CommissionLogService.failed({
                        recipientId: user.patronId,
                        sourceUserId: user.id,
                        type: 'patron',
                        amount: commission,
                        reason: `Patron ${user.patronId} record not found`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                } else if (!patron.patronId) {
                    await CommissionLogService.skipped({
                        recipientId: patron.id,
                        sourceUserId: user.id,
                        type: 'patron',
                        amount: commission,
                        reason: `Patron has no upline patron set - commission not applicable`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                } else {
                    const patWallet = patron.wallets.find((w: any) => w.type === WalletType.direct);
                    if (patWallet) {
                        await client.wallet.update({
                            where: { id: patWallet.id },
                            data: { amount: { increment: commission } }
                        });

                        await CommissionLogService.success({
                            recipientId: patron.id,
                            sourceUserId: user.id,
                            type: 'patron',
                            amount: commission,
                            walletType: WalletType.direct,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    } else {
                        await CommissionLogService.failed({
                            recipientId: patron.id,
                            sourceUserId: user.id,
                            type: 'patron',
                            amount: commission,
                            walletType: WalletType.direct,
                            reason: `No direct wallet exists for this patron to credit`,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    }
                }
            }

            // Update user status
            await client.user.update({
                where: { id: user.id },
                data: {
                    status: true,
                    canEarn: true,
                    activatedAt: new Date()
                }
            });

            // Give commission to super admin
            if (superAdminId) {
                const superAdmin = await client.user.findUnique({
                    where: { id: superAdminId },
                    include: { wallets: true }
                });

                if (!superAdmin) {
                    await CommissionLogService.failed({
                        recipientId: superAdminId,
                        sourceUserId: user.id,
                        type: 'super_admin',
                        reason: `Super admin ${superAdminId} record not found`,
                        reference,
                        processedVia,
                        tx: context.tx,
                    });
                } else {
                    const superDirect = superAdmin.wallets.find((w: any) => w.type === WalletType.direct);
                    if (superDirect) {
                        await client.wallet.update({
                            where: { id: superDirect.id },
                            data: { amount: { increment: commission } }
                        });

                        await CommissionLogService.success({
                            recipientId: superAdmin.id,
                            sourceUserId: user.id,
                            type: 'super_admin',
                            amount: commission,
                            walletType: WalletType.direct,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    } else {
                        await CommissionLogService.failed({
                            recipientId: superAdmin.id,
                            sourceUserId: user.id,
                            type: 'super_admin',
                            amount: commission,
                            walletType: WalletType.direct,
                            reason: `No direct wallet exists for the super admin to credit`,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    }

                    const superCentral = superAdmin.wallets.find((w: any) => w.type === WalletType.central_treasury);
                    if (superCentral) {
                        await client.wallet.update({
                            where: { id: superCentral.id },
                            data: { amount: { increment: 1 } }
                        });

                        await CommissionLogService.success({
                            recipientId: superAdmin.id,
                            sourceUserId: user.id,
                            type: 'super_admin',
                            amount: 1,
                            walletType: WalletType.central_treasury,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    } else {
                        await CommissionLogService.failed({
                            recipientId: superAdmin.id,
                            sourceUserId: user.id,
                            type: 'super_admin',
                            amount: 1,
                            walletType: WalletType.central_treasury,
                            reason: `No central treasury wallet exists for the super admin to credit`,
                            reference,
                            processedVia,
                            tx: context.tx,
                        });
                    }
                }
            }
        }
    }
}
