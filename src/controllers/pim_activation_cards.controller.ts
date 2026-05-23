
import { NextFunction, Request, Response } from 'express';
import { ACTIVATION_CARD_STATUSES, COMPANY_DETAILS, INFANT_FORM_FEE, PAGA, ROLES } from "../config/constants";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { paginate } from '../utils/pagination';
import { PagaService } from '../services/paga.service';
import { sendSuccess } from '../utils/responseWrapper';
import { addMinutes, format, subYears } from 'date-fns';

export const getUserCardsSummary = asyncHandler(async (req: any, res: Response) => {
    const user = req.user;

    const [totalCards, slotsResult, pendingCards, cardPrice, activeCardResult] = await Promise.all([
        // totalCard Query
        prisma.activationCard.count({
            where: {
                userId: user.id,
                status: { not: ACTIVATION_CARD_STATUSES.CANCELLED }
            }
        }),
        // availableSlots Query
        prisma.$queryRaw<any[]>`
            SELECT 
                FLOOR(ac.amount / ac.price_per_user) AS "totalSlots",
                COALESCE(u.numUsers, 0) AS "usedSlots",
                FLOOR(ac.amount / ac.price_per_user) - COALESCE(u.numUsers, 0) AS "availableSlots"
            FROM activation_cards ac
            LEFT JOIN (
                SELECT activation_card_id, COUNT(*) AS numUsers
                FROM users
                WHERE activation_card_id IS NOT NULL
                GROUP BY activation_card_id
            ) u ON u.activation_card_id = ac.id
            WHERE
                ac.user_id = ${user.id}
                AND ac.status = ${ACTIVATION_CARD_STATUSES.APPROVED}
                AND ac.price_per_user > 0
            ORDER BY ac.created_at DESC
            LIMIT 1
        `,
        // pendingCards Query
        prisma.activationCard.count({
            where: {
                userId: user.id,
                status: ACTIVATION_CARD_STATUSES.PENDING,
                code: null
            }
        }),
        // cardPrice Query
        prisma.setting.findFirst({
            where: { key: 'gkwth_sale_price' }
        }),
        // activeCard Query
        prisma.$queryRaw<any[]>`
            SELECT
                id,
                code,
                amount,
                pricePerUser,
                createdAt,
                slots
            FROM (
                SELECT
                    ac.id,
                    ac.code,
                    ac.amount,
                    ac.price_per_user AS "pricePerUser",
                    ac.created_at AS "createdAt",
                    FLOOR(ac.amount / ac.price_per_user) - COALESCE(u.numUsers, 0) AS slots
                FROM activation_cards ac
                LEFT JOIN (
                    SELECT activation_card_id, COUNT(*) AS numUsers
                    FROM users
                    WHERE activation_card_id IS NOT NULL
                    GROUP BY activation_card_id
                ) u ON u.activation_card_id = ac.id
                WHERE
                    ac.user_id = ${user.id}
                    AND ac.status = ${ACTIVATION_CARD_STATUSES.APPROVED}
                    AND ac.price_per_user > 0
            ) AS card_summary
            WHERE slots > 0
            ORDER BY createdAt DESC
            LIMIT 1
        `,
    ]);

    const pagaService = new PagaService();
    const price = cardPrice
        ? Number(cardPrice.value) + pagaService.calculateCharge(Number(cardPrice.value))
        : 0;

    const availableSlots = Number(slotsResult[0]?.availableSlots ?? 0);
    const usedSlots = Number(slotsResult[0]?.usedSlots ?? 0);
    const totalSlots = Number(slotsResult[0]?.totalSlots ?? 0);
    const activeCard = activeCardResult[0] ?? null;

    return sendSuccess(res, 200, 'User cards summary fetched successfully', {
        totalCards,
        availableSlots,
        usedSlots,
        totalSlots,
        pendingCards,
        price,
        activeCard,
        status: ACTIVATION_CARD_STATUSES
    });
});

export const getUserCards = asyncHandler(async (req: any, res: Response) => {
    const user = req.user;

    const { page, limit, status } = req.query;

    const whereClause: any = {
        userId: BigInt(user.id),
        OR: [
            { status: { not: ACTIVATION_CARD_STATUSES.PENDING } },
            {
                status: ACTIVATION_CARD_STATUSES.PENDING,
                proofOfPayment: {
                    not: {
                        contains: 'ACTIVATIONCARD'
                    }
                }
            }
        ]
    };

    if (status !== undefined && status !== null) {
        whereClause.status = status;
    }

    const paginationResult = await paginate(
        prisma.activationCard,
        {
            where: whereClause,
            include: {
                usersWithCard: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        isInfant: true,
                        sponsorId: true,
                        birthDate: true,
                        createdAt: true,
                    }
                },
                _count: {
                    select: {
                        usersWithCard: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        },
        {
            page: Number(page),
            limit: Number(limit)
        }
    );

    const data = paginationResult.data.map((card: any) => {
        let totalUsedAmount = 0;
        const users = card.usersWithCard.map((u: any) => {
            const isIndependentInfant = !u.sponsorId && u.birthDate && new Date(u.birthDate) > subYears(card.createdAt, 18);
            const extraFee = isIndependentInfant ? INFANT_FORM_FEE : 0;
            const amountUsed = Number(card.pricePerUser) + extraFee;
            totalUsedAmount += amountUsed;
            return {
                ...u,
                id: u.id.toString(),
                sponsorId: u.sponsorId?.toString(),
                amountUsed
            };
        });

        const amountLeft = Number(card.amount) - totalUsedAmount;
        const slotsLeft = Math.floor(amountLeft / Number(card.pricePerUser));

        return {
            ...card,
            id: card.id.toString(),
            userId: card.userId.toString(),
            usersWithCard: users,
            amountLeft,
            slotsLeft
        };
    });

    return sendSuccess(res, 200, 'User cards fetched successfully', {
        ...paginationResult,
        data
    });
})


export const generateVirtualAccountForCardPurchase = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { quantity, amount: inputAmount } = req.body;
    const { id: userId } = req.user;

    if (!quantity || quantity < 2) {
        return sendSuccess(res, 400, 'Minimum purchase quantity is 2 cards');
    }

    const [activePriceSetting, user] = await Promise.all([
        prisma.setting.findFirst({
            where: { key: 'gkwth_sale_price' }
        }),
        prisma.user.findFirst({
            where: { id: userId },
            include: { guardianUser: true }
        })
    ]);

    if (!activePriceSetting) {
        return sendSuccess(res, 400, 'Card price settings not found');
    }

    const activePrice = Number(activePriceSetting.value);
    const isDevUser = user?.username === 'dev_user';
    const totalWithoutCharges = isDevUser ? 100 : (activePrice * quantity);

    const pagaService = new PagaService();
    const charges = isDevUser ? 0.87 : pagaService.calculateCharge(totalWithoutCharges);
    const totalWithCharges = isDevUser ? 100.87 : totalWithoutCharges + charges;

    if (!isDevUser && inputAmount < totalWithCharges) {
        return sendSuccess(res, 400, 'Amount is less than the required amount (including charges)');
    }

    const ref = pagaService.generateReference('ACTIVATIONCARD');

    const response = await pagaService.generateVirtualAccount(
        totalWithoutCharges,
        user?.name as string,
        (user?.phone ?? user?.guardianUser?.phone ?? COMPANY_DETAILS.PHONE_NUMBER) as string,
        ref
    );

    if (!response.success) {
        return sendSuccess(res, 400, response?.error || 'Failed to generate virtual account');
    }

    // Clean up old pending activation card requests for this user
    await prisma.activationCard.deleteMany({
        where: {
            userId: userId as bigint,
            status: {
                not: ACTIVATION_CARD_STATUSES.APPROVED
            },
            proofOfPayment: {
                startsWith: 'ACTIVATIONCARD'
            }
        }
    });

    // Create the new card record
    await prisma.activationCard.create({
        data: {
            userId: userId as bigint,
            amount: totalWithCharges,
            pricePerUser: activePrice,
            proofOfPayment: ref,
            status: ACTIVATION_CARD_STATUSES.PENDING
        }
    });

    return sendSuccess(res, 200, 'Virtual account generated successfully', {
        account_detail: {
            account_name: response.data.account_name,
            bank_name: response.data.bank_name,
            account_number: response.data.virtual_account,
            bank_uuid: response.data.bank_uuid,
            expiry_date: response.data.expiry_date_full ? format(new Date(response.data.expiry_date_full), 'HH:mm') : format(addMinutes(new Date(), 28), 'HH:mm'),
            amount: totalWithCharges,
            reference: ref
        }
    });
});

export const verifyCardPurchasePayment = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { reference } = req.body;
    const { id: userId } = req.user;

    if (!reference) {
        return sendSuccess(res, 400, 'Reference is required');
    }

    const activationCard = await prisma.activationCard.findFirst({
        where: {
            proofOfPayment: reference,
            userId: userId as bigint,
        }
    });

    if (!activationCard) {
        return sendSuccess(res, 404, 'Activation card not found');
    }

    if(activationCard.status === ACTIVATION_CARD_STATUSES.APPROVED){
        return sendSuccess(res, 200, 'Activation card already approved');
    }

    const pagaService = new PagaService();
    const response = await pagaService.verifyPayment(reference);

    if (!response.success || !response.is_paid) {
        return sendSuccess(res, 400, response?.error || 'Failed to verify payment');
    }

    if (Number(response.amount) !== Number(activationCard.amount)) {
        return sendSuccess(res, 400, 'Amount is less than the required amount (including charges)');
    }

    // if (response.data.status !== 'ACTIVE') {
    //     return sendSuccess(res, 400, 'Virtual account is not active');
    // }

    // Generate a random unique 10-character code
    let code = '';
    let isUnique = false;
    while (!isUnique) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 10; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        code = result;

        const existing = await prisma.activationCard.findUnique({
            where: { code }
        });
        if (!existing) {
            isUnique = true;
        }
    }

    // Find the super admin's user ID
    const superAdmin = await prisma.user.findFirst({
        where: { role: ROLES.SUPER_ADMIN }
    });

    await prisma.activationCard.update({
        where: {
            id: activationCard.id
        },
        data: {
            code,
            approvedBy: superAdmin?.id ?? null,
            status: ACTIVATION_CARD_STATUSES.APPROVED
        }
    });

    return sendSuccess(res, 200, 'Card purchase verified successfully', { code });
});

export const initiateCardPurchasePayment = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { quantity, amount: inputAmount } = req.body;
    const { id: userId } = req.user;

    if (!quantity || quantity < 2) {
        return sendSuccess(res, 400, 'Minimum purchase quantity is 2 cards');
    }

    const [activePriceSetting, user] = await Promise.all([
        prisma.setting.findFirst({ where: { key: 'gkwth_sale_price' } }),
        prisma.user.findFirst({
            where: { id: userId },
            include: { guardianUser: true }
        })
    ]);

    if (!activePriceSetting) {
        return sendSuccess(res, 400, 'Card price settings not found');
    }

    const pagaService = new PagaService();
    const activePrice = Number(activePriceSetting.value);
    const isDevUser = user?.username === 'dev_user';
    const totalWithoutCharges = isDevUser ? 100 : (activePrice * quantity);
    const charges = isDevUser ? 0.87 : pagaService.calculateCharge(totalWithoutCharges);
    const totalWithCharges = isDevUser ? 100.87 : totalWithoutCharges + charges;

    if (!isDevUser && inputAmount < totalWithCharges) {
        return sendSuccess(res, 400, 'Amount is less than the required amount (including charges)');
    }

    const ref = pagaService.generateReference('ACTIVATIONCARD');

    // Remove old pending Paga card payment requests for this user
    await prisma.activationCard.deleteMany({
        where: {
            userId: userId as bigint,
            status: { not: ACTIVATION_CARD_STATUSES.APPROVED },
            proofOfPayment: { startsWith: 'ACTIVATIONCARD' }
        }
    });

    await prisma.activationCard.create({
        data: {
            userId: userId as bigint,
            amount: totalWithCharges,
            pricePerUser: activePrice,
            proofOfPayment: ref,
            status: ACTIVATION_CARD_STATUSES.PENDING
        }
    });

    return sendSuccess(res, 200, 'Card payment initiated', {
        reference: ref,
        amount: totalWithCharges,
        publicKey: PAGA.USERNAME,
        email: user?.email,
        phoneNumber: user?.phone ?? user?.guardianUser?.phone ?? ''
    });
});