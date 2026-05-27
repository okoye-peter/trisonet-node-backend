import { prisma, WalletType } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { Request, Response, NextFunction } from 'express';
import { PagaService } from "../services/paga.service";
import { AppError } from "../utils/AppError";

const paga = new PagaService();

export const fixActivationCardWithUnverifiedPayment = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const activationCardsTotal = await prisma.activationCard.count({
            where: {
                status: 1,
                createdAt: { gte: new Date((new Date()).getDay() - 5) }
            },
        })

    const limit = 10;
        const count = Math.ceil(activationCardsTotal / limit);
        for (let index = 0; index < count; index++) {
            const activationCards = await prisma.activationCard.findMany({
                where: {
                    status: 1,
                    createdAt: { gte: new Date((new Date()).getDay() - 5) }
                },
                take: limit,
                skip: (limit * index)
            })

            if(activationCards.length == 0) return;

            activationCards.forEach(async (card) => {
                if(card.proofOfPayment && card.proofOfPayment.startsWith('ACTIVATIONCARD')){
                    const res = await paga.verifyPayment(card.proofOfPayment);

                    if (!res.success) {
                        throw new AppError((res as any).error ?? 'Payment verification failed', 400);
                    }

                    const status = res?.status === 'success' && res.data?.full_response?.statusMessage === 'success' && res.data?.full_response?.data?.statusMessage === 'success'
                

                    if(!status) {
                        const users = await prisma.user.findMany({
                            where: {
                                status: true,
                                activationCardId: card.id
                            }
                        })

                        if(users.length) {
                            users.forEach(async (user) => {
                                if(user.activatedAt && new Date(user.activatedAt) >= new Date("2026-05-24") && user.referralId) {
                                    await prisma.wallet.updateMany({
                                        data: {
                                            amount: { decrement: 2000}
                                        },
                                        where: {
                                            type: WalletType.direct,
                                            userId: BigInt(user.referralId)
                                        }
                                    })
                                }

                                await prisma.wallet.updateMany({
                                    data: {
                                        amount: 0
                                    },
                                    where: {
                                        type: WalletType.indirect,
                                        userId: BigInt(user.id)
                                    }
                                })

                                await prisma.user.update({
                                    data: {
                                        status: false,
                                        activatedAt: null
                                    },
                                    where: {
                                        id: user.id
                                    }
                                })
                            })
                        }

                        prisma.activationCard.delete({
                            where: { id: card.id}
                        })
                    }
                }
            })
        }

    } catch (error) {
        
    }
});