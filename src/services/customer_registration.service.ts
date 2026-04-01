import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import RegionService from "./region.service";
import { ROLES } from "../config/constants";
import { handleReferral } from "./referral.service";
import WalletService from "./wallet.service";
import { WalletType } from "../generated/prisma/index.js";
import { AccountActivationService } from "./account_activation.service";
import { User } from "../generated/prisma/index.js";

interface UserRequestData {
    name: string;
    username: string;
    email: string;
    phone: string;
    region_id: string;
    country: string;
    password: string;
    confirm_password: string;
    referral_id: string;
    activation_code?: string;
    picture_url?: string | null;
}

export const createUser = async (data: UserRequestData) => {
    const { name, username, email, phone, region_id, country, password, confirm_password, referral_id, activation_code, picture_url } = data;
    if (name.split(' ').length == 1) {
        throw new Error('Please provide your full name');
    }

    // Run all independent checks in parallel
    const [existingUser, activationCard, regionLimitReached, referral, hashedPassword] = await Promise.all([
        prisma.user.findFirst({
            where: { OR: [{ email }, { username }, { phone }] },
            select: { email: true, username: true, phone: true },
        }),
        activation_code
            ? prisma.activationCard.findFirst({
                where: { code: activation_code },
                include: { _count: { select: { usersWithCard: true } } },
            })
            : null,
        RegionService.isRegionLimitReached(BigInt(region_id), ROLES.CUSTOMER),
        handleReferral(referral_id, region_id, undefined, ROLES.CUSTOMER),
        bcrypt.hash(password, 12),
    ]);

    if (existingUser) {
        if (existingUser.email === email) throw new Error('Email already in use');
        if (existingUser.username === username) throw new Error('Username already in use');
        if (existingUser.phone === phone) throw new Error('Phone number already in use');
    }

    if (activation_code) {
        if (!activationCard) {
            throw new Error('Invalid activation code');
        }
        if (activationCard._count.usersWithCard >= Math.round(activationCard.amount / activationCard.pricePerUser)) {
            throw new Error('Activation code has been exhausted');
        }
    }

    if (regionLimitReached) {
        throw new Error('This region competition has ended, please select another region');
    }

    if (!referral.referralId && referral_id) {
        throw new Error('Referral ID is invalid');
    }

    const { referralId, influencerId, influencerPromoPeriodId } = referral;

    const user = await prisma.user.create({
        data: {
            name,
            username,
            email,
            phone,
            regionId: BigInt(region_id),
            country,
            password: hashedPassword,
            referralId,
            influencerId,
            influencerPromoPeriodId,
            pictureUrl: picture_url ?? null,
        },
        omit: {
            withdrawalPinResetOtp: true,
            withdrawalPinResetOtpSentAt: true,
            emailVerificationCode: true,
            emailVerificationCodeSentAt: true,
            password: true,
            passwordResetOtp: true,
            passwordResetOtpSentAt: true,
            referralActivateAt: true,
            activatedAt: true,
            lastSeen: true,
            canWithdraw: true,
            canUseVtu: true,
            canEarn: true,
            canOptOut: true,
            canWithdrawGkwth: true,
            sponsorshipAcceptedAt: true,
            sponsorAgreement: true,
            sponsorLoginOtp: true,
            sponsorLoginOtpCreatedAt: true,
            sponsorWithdrawalOtp: true,
            sponsorWithdrawalOtpSentAt: true,
            isDeactivated: true,
            sponsorSlot: true,
            loginYearlyCount: true,
            schoolFeesPermittedAt: true,
            withdrawalBypassAt: true,
            isUnitLeader: true,
            patronGroupId: true,
            activationCardId: true,
            blockedAt: true,
        },
        include: {
            region: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    await WalletService.createWallets(user.id, ROLES.CUSTOMER);
    await handleAdultSponsorship(user.id, referral_id);

    return user;
}

const handleAdultSponsorship = async (userId: bigint, username: string) => {
    username = username.trim();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== ROLES.CUSTOMER || user.isInfant || !username) return;

    const patron = await prisma.user.findFirst({
        where: { username, role: ROLES.PATRON },
        include: { wallets: true },
    });

    if (!patron) return;

    // Use patron.patronId if available, otherwise fallback to patron.id (matching `$patron->patron_id ?? $patron->id`)
    const targetPatronId = patron.patronId || patron.id;

    // Find patronage wallet for this target patron
    const wallet = await prisma.wallet.findFirst({
        where: {
            type: WalletType.patronage,
            userId: targetPatronId,
        },
    });

    if (!wallet) return;

    const gkwthSalePriceStr = await prisma.setting.findUnique({
        where: { key: 'gkwth_sale_price' },
    });
    const activationFee = gkwthSalePriceStr ? parseFloat(gkwthSalePriceStr.value) : 0;

    if (wallet.amount > activationFee) {
        // Update user's patron_id
        await prisma.user.update({
            where: { id: user.id },
            data: { patronId: patron.id },
        });

        await AccountActivationService.activateUserAccountOptimized(user.id);

        // Deduct from wallet
        await prisma.wallet.update({
            where: { id: wallet.id },
            data: { amount: { decrement: activationFee } },
        });

        if (patron.patronId) {
            const commissionPriceStr = await prisma.setting.findUnique({
                where: { key: 'commission_price' },
            });
            const commission = commissionPriceStr ? parseFloat(commissionPriceStr.value) : 0;

            const directWallet = patron.wallets.find((w: any) => w.type === WalletType.direct);
            if (directWallet) {
                await prisma.wallet.update({
                    where: { id: directWallet.id },
                    data: { amount: { increment: commission } },
                });
            }
        }
    }
}