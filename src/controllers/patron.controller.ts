import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AppError } from '../utils/AppError';
import { sendSuccess, sendPaginated } from '../utils/responseWrapper';
import { ROLES, MAX_PATRONS_PER_GROUP } from '../config/constants';
import { TermiiService } from '../services/termii.service';
import { PagaService } from '../services/paga.service';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import WalletService from '../services/wallet.service';
import { PaymentService } from '../services/payment.service';

const pagaService = new PagaService();

/**
 * Get Patron Dashboard Data
 * Returns organization details, members, and transactions
 */
export const getDashboard = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    let patronGroup = null;
    let balance = 0;
    let transactions: any[] = [];
    let totalTransactions = 0;

    const page = Number(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    let isFunded = false;
    let minRequirement = 0;

    if (user.patronGroupId) {
        patronGroup = await prisma.patronGroup.findUnique({
            where: { id: user.patronGroupId },
            include: {
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                    }
                },
                plan: true,
                _count: {
                    select: {
                        users: true,
                    }
                }
            }
        });

        if (patronGroup) {
            // Get group balance
            const credits = await prisma.patronGroupTransaction.aggregate({
                where: { patronGroupId: patronGroup.id, type: 'credit', status: 'success' },
                _sum: { amount: true }
            });
            const debits = await prisma.patronGroupTransaction.aggregate({
                where: { patronGroupId: patronGroup.id, type: 'debit', status: 'success' },
                _sum: { amount: true }
            });
            balance = (Number(credits._sum?.amount) || 0) - (Number(debits._sum?.amount) || 0);

            // Check if funded based on min amount of plan
            const plan = (patronGroup as any).plan;
            if (plan) {
                minRequirement = plan.minAmount;
                const qualifyingTransaction = await prisma.patronGroupTransaction.findFirst({
                    where: {
                        patronGroupId: patronGroup.id,
                        type: 'credit',
                        status: 'success',
                        amount: { gte: plan.minAmount }
                    }
                });
                isFunded = !!qualifyingTransaction;
            }

            // Get transactions
            [transactions, totalTransactions] = await Promise.all([
                prisma.patronGroupTransaction.findMany({
                    where: { patronGroupId: patronGroup.id, status: 'success' },
                    include: {
                        user: { select: { id: true, name: true } },
                        wallet: { select: { id: true, user: { select: { id: true, name: true } } } }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limit,
                }),
                prisma.patronGroupTransaction.count({ where: { patronGroupId: patronGroup.id } })
            ]);
        }
    }

    // Get members (patrons directly recruited by this user)
    const [members, totalMembers] = await Promise.all([
        prisma.user.findMany({
            where: { patronId: user.id, role: ROLES.PATRON },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                patronId: true,
                createdAt: true,
                _count: {
                    select: { patronees: true } // Beneficiaries
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.user.count({ where: { patronId: user.id, role: ROLES.PATRON } })
    ]);

    // Get total beneficiaries (direct recruits of my members + my direct recruits)
    const memberIds = members.map(m => m.id);
    const totalBeneficiaries = await prisma.user.count({
        where: { patronId: { in: [...memberIds, user.id] } }
    });

    return sendSuccess(res, 200, 'Dashboard data retrieved successfully', {
        patronGroup: patronGroup ? {
            ...patronGroup,
            planName: (patronGroup as any).plan?.name || 'Organization',
            balance,
            isFunded,
            minRequirement
        } : null,
        members,
        transactions,
        meta: {
            totalMembers: totalMembers,
            totalBeneficiaries: totalBeneficiaries,
            walletBalance: balance,
            members: {
                total: totalMembers,
                page,
                totalPages: Math.ceil(totalMembers / limit)
            },
            beneficiaries: {
                total: totalBeneficiaries
            },
            transactions: {
                total: totalTransactions,
                page,
                totalPages: Math.ceil(totalTransactions / limit)
            }
        }
    });
});

/**
 * Get Patron Members
 * Returns a searchable list of members in the organization
 */
export const getMembers = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const search = req.query.search as string;

    const page = Number(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const where: any = {
        patronId: user.id, // Members are those directly recruited by the user
        role: ROLES.PATRON,
    };

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
        ];
    }

    const [members, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                patronId: true,
                createdAt: true,
                _count: {
                    select: { patronees: true }
                }
            },
            orderBy: { name: 'asc' },
            skip,
            take: limit,
        }),
        prisma.user.count({ where })
    ]);

    return sendSuccess(res, 200, 'Members retrieved successfully', {
        members,
        meta: {
            total,
            page,
            totalPages: Math.ceil(total / limit)
        }
    });
});

/**
 * Get Patron Beneficiaries
 * Returns all beneficiaries linked to patrons in the current organization
 */
export const getBeneficiaries = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    const page = Number(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    let beneficiaryFilter: any = {
        role: ROLES.CUSTOMER,
        status: true // Only activated customers
    };

    if (!user.patronId) {
        // Top-level patron: see own beneficiaries + all members' beneficiaries
        // Members are people where patronId is the current user.id and role is PATRON
        const members = await prisma.user.findMany({
            where: { patronId: user.id, role: ROLES.PATRON },
            select: { id: true }
        });
        const memberIds = members.map(m => m.id);
        beneficiaryFilter.patronId = { in: [...memberIds, user.id] };
    } else {
        // Member patron: see only own direct beneficiaries
        beneficiaryFilter.patronId = user.id;
    }

    const [beneficiaries, total] = await Promise.all([
        prisma.user.findMany({
            where: beneficiaryFilter,
            select: {
                id: true,
                name: true,
                username: true,
                email: true,
                phone: true,
                createdAt: true,
                patron: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.user.count({ where: beneficiaryFilter })
    ]);

    return sendSuccess(res, 200, 'Beneficiaries retrieved successfully', {
        beneficiaries,
        meta: {
            total,
            page,
            totalPages: Math.ceil(total / limit)
        }
    });
});

/**
 * Create a new Patron Group
 */
export const createGroup = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // Currently disabled in PHP, but implemented here for completeness
    // return next(new AppError('This feature is currently unavailable', 400));

    const user = (req as any).user;
    const { name, amount, type, plan } = req.body;

    if (user.role !== ROLES.PATRON) {
        return next(new AppError('Unauthorized. Only patrons can manage organizations.', 403));
    }

    // If they have a group, check if it's funded
    if (user.patronGroupId) {
        const qualifyingTransaction = await prisma.patronGroupTransaction.findFirst({
            where: {
                patronGroupId: user.patronGroupId,
                type: 'credit',
                status: 'success',
                // We don't check amount here, if they have ANY success activation credit, they are funded
            }
        });

        if (qualifyingTransaction) {
            return next(new AppError('Your organization is already established and funded.', 400));
        }
    }

    const patronType = type || user.pendingPatronType || 'individual';
    const patronPlan = plan || 'bronze';
    let planConfig: any = null;

    if (patronType === 'group') {
        planConfig = await (prisma as any).patronPlan.findUnique({
            where: { name: patronPlan as string }
        });

        if (!planConfig) {
            return next(new AppError('Invalid patron plan selected', 400));
        }

        if (amount < planConfig.minAmount || amount > planConfig.maxAmount) {
            return next(new AppError(`Amount for ${patronPlan} plan must be between ₦${planConfig.minAmount.toLocaleString()} and ₦${planConfig.maxAmount.toLocaleString()}`, 400));
        }
    } else {
        if (amount < 1000000) {
            return next(new AppError('Amount must be at least 1,000,000 for individual patrons', 400));
        }
    }

    // Logic for card debit or virtual account generation would go here
    // For now, following PHP logic but creating the group directly as if payment succeeded
    
    const paga = new PagaService();
    const charge = paga.calculateCharge(amount);
    const totalAmount = amount + charge;
    const reference = paga.generateReference('PG_FUND');

    const result = await paga.generateVirtualAccount(
        totalAmount,
        name,
        user.phone || '',
        reference
    );

    if (!result.success) {
        return next(new AppError(result.error || 'Failed to generate payment details. Please try again.', 500));
    }

    const paymentData = result.data;

    const response = await prisma.$transaction(async (tx) => {
        let group;
        if (user.patronGroupId) {
            // Update existing unfunded group
            group = await tx.patronGroup.update({
                where: { id: user.patronGroupId },
                data: {
                    name: name.toLowerCase(),
                    plan: planConfig ? { connect: { id: planConfig.id } } : undefined,
                }
            });
        } else {
            // Create new group
            group = await tx.patronGroup.create({
                data: {
                    name: name.toLowerCase(),
                    owner: { connect: { id: BigInt(user.id) } },
                    type: patronType,
                    plan: planConfig ? { connect: { id: planConfig.id } } : undefined,
                }
            });

            await tx.user.update({
                where: { id: user.id },
                data: { 
                    patronGroupId: group.id,
                    pendingPatronType: null
                }
            });
        }

        // Cancel previous pending transactions for this group (to avoid confusion)
        await tx.patronGroupTransaction.updateMany({
            where: {
                patronGroupId: group.id,
                status: 'pending',
                type: 'credit'
            },
            data: { status: 'failed' } // Mark as failed/cancelled
        });

        // Create new pending transaction with new amount/charge
        await tx.patronGroupTransaction.create({
            data: {
                patronGroupId: group.id,
                amount: amount,
                charge: charge,
                reference: reference,
                type: 'credit',
                status: 'pending',
                description: `Organization activation funding for ${name} (${planConfig?.name || 'Standard'} Plan)`
            }
        });

        return {
            group,
            payment: {
                bank_name: paymentData.bank_name,
                account_number: paymentData.virtual_account,
                account_name: paymentData.account_name,
                amount: totalAmount,
                subtotal: amount,
                charge: charge,
                reference: reference,
                expires_at: paymentData.expires_at
            }
        };
    });

    return sendSuccess(res, 201, 'Organization created. Please fund to activate.', response);
});

/**
 * Add a new patron member to the group
 */
export const addMember = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { name, email, phone, password: providedPassword } = req.body;

    // Only top-level patrons (those without a patronId) can add members
    if (user.role !== ROLES.PATRON || (!user.patronGroupId && !user.patronId)) {
        return next(new AppError('Unauthorized. Only individual patrons or patrons with an organization can add members.', 403));
    }

    const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email }, { phone }] }
    });

    if (existingUser) {
        return next(new AppError('User with this email or phone already exists', 400));
    }

    // Generate unique username
    let username = '';
    let usernameExists = true;
    while (usernameExists) {
        username = crypto.randomBytes(5).toString('hex'); // 10 chars
        const count = await prisma.user.count({ where: { username } });
        if (count === 0) usernameExists = false;
    }

    const password = providedPassword || Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
            data: {
                name,
                email,
                phone,
                username,
                role: ROLES.PATRON,
                patronId: user.id,
                password: hashedPassword,
                status: true,
                accountState: 1
            }
        });

        // Create wallets for the member (direct and patronage)
        await WalletService.createWallets(createdUser.id, ROLES.PATRON, tx);

        return createdUser;
    });

    // Send SMS
    if (process.env.NODE_ENV === 'production') {
        await TermiiService.sendSms(phone, `Your patron account has been created. Email: ${email} Password: ${password}`);
    }

    return sendSuccess(res, 201, 'Patron member created successfully', {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        password // Returning temporary password for convenience in development
    });
});

export const createOrganizationCoPatron = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { name, email, phone, password: providedPassword } = req.body;

    // Only top-level patrons (those without a patronId) can add members
    if (user.role !== ROLES.PATRON || !user.patronGroupId) {
        return next(new AppError('Unauthorized. Only patron organization leader can add co-patrons', 403));
    }

    const patronGroup = await prisma.patronGroup.findUnique({
        where: { id: user.patronGroupId }
    });

    if (patronGroup?.userId !== user.id) {
        return next(new AppError('Unauthorized. Only organization leader can add co-patrons', 403));
    }

    const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email }, { phone }] }
    });

    if (existingUser) {
        return next(new AppError('User with this email or phone already exists', 400));
    }

    // Generate unique username
    let username = '';
    let usernameExists = true;
    while (usernameExists) {
        username = crypto.randomBytes(5).toString('hex'); // 10 chars
        const count = await prisma.user.count({ where: { username } });
        if (count === 0) usernameExists = false;
    }

    const password = providedPassword || Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
            data: {
                name,
                email,
                phone,
                username,
                role: ROLES.PATRON,
                patronId: user.id,
                patronGroupId: user.patronGroupId,
                password: hashedPassword,
                status: true,
                accountState: 1
            }
        });

        // Create wallets for the member (direct and patronage)
        await WalletService.createWallets(createdUser.id, ROLES.PATRON, tx);

        return createdUser;
    });

    // Send SMS
    if (process.env.NODE_ENV === 'production') {
        await TermiiService.sendSms(phone, `Your patron account has been created. Email: ${email} Password: ${password}`);
    }

    return sendSuccess(res, 201, 'Patron member created successfully', {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        password // Returning temporary password for convenience in development
    });

});

/**
 * Credit a patron member's wallet from organization balance
 */
export const creditMember = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { amount, member_id } = req.body;
    const memberId = BigInt(member_id);

    if (!user.patronGroupId || user.role !== ROLES.PATRON) {
        return next(new AppError('Unauthorized', 403));
    }

    const patronGroup = await prisma.patronGroup.findUnique({
        where: { id: user.patronGroupId }
    });

    if (!patronGroup || patronGroup.userId !== user.id) {
        return next(new AppError('Unauthorized to manage this group', 403));
    }

    // Get group balance
    const [credits, debits] = await Promise.all([
        prisma.patronGroupTransaction.aggregate({
            where: { patronGroupId: patronGroup.id, type: 'credit', status: 'success' },
            _sum: { amount: true }
        }),
        prisma.patronGroupTransaction.aggregate({
            where: { patronGroupId: patronGroup.id, type: 'debit', status: 'success' },
            _sum: { amount: true }
        })
    ]);
    const groupBalance = (Number(credits._sum.amount) || 0) - (Number(debits._sum.amount) || 0);

    if (amount > groupBalance) {
        return next(new AppError('Insufficient organization wallet balance', 400));
    }

    const member = await prisma.user.findFirst({
        where: { id: memberId, patronGroupId: patronGroup.id, role: ROLES.PATRON }
    });

    if (!member) {
        return next(new AppError('Patron member not found in your organization', 404));
    }

    const transaction = await prisma.$transaction(async (tx) => {
        // Find or create patronage wallet for member
        let wallet = await tx.wallet.findFirst({
            where: { userId: memberId, type: 'patronage' }
        });

        if (!wallet) {
            wallet = await tx.wallet.create({
                data: { userId: memberId, type: 'patronage', amount: 0 }
            });
        }

        // Increment member wallet
        await tx.wallet.update({
            where: { id: wallet.id },
            data: { amount: { increment: amount } }
        });

        // Create group transaction record (debit)
        const groupTx = await tx.patronGroupTransaction.create({
            data: {
                patronGroupId: patronGroup.id,
                amount: amount,
                charge: 0,
                type: 'debit',
                userId: user.id,
                reference: `PATRON-CREDIT-${crypto.randomUUID()}`,
                description: `Credited patron NAME: ${member.name}, Email: ${member.email} with amount ${amount}`,
                walletId: wallet.id,
                status: 'success'
            }
        });

        return groupTx;
    });

    return sendSuccess(res, 200, 'Member credited successfully', transaction);
});

/**
 * Initiate patronage wallet funding
 */
export const initiateFunding = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { amount } = req.body;

    if (amount < 1000) {
        return next(new AppError('Minimum funding amount is ₦1,000', 400));
    }

    const paymentService = new PaymentService();
    const result = await paymentService.initiatePatronageWalletFunding(BigInt(user.id), amount, user);

    return sendSuccess(res, 200, 'Funding initiated', result);
});

/**
 * Check funding status
 */
export const checkFundingStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const reference = req.params.reference as string;

    // 1. Check if the funding record still exists in our DB
    const fundingRecord = await prisma.manuallyFunding.findFirst({
        where: { receipt: reference }
    });

    // 2. If record is gone, it might have been processed by webhook already
    if (!fundingRecord) {
        return sendSuccess(res, 200, 'Transaction status checked', { status: 'success' });
    }

    return sendSuccess(res, 200, 'Transaction status checked', { status: 'pending' });
});

/**
 * Send OTP for Patron Withdrawal Authentication
 */
export const sendWithdrawalOtp = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (user.role !== ROLES.PATRON) {
        return next(new AppError('Unauthorized', 403));
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            sponsorWithdrawalOtp: otp,
            sponsorWithdrawalOtpSentAt: new Date()
        }
    });

    // Send Mail using Termii
    const mailResult = await TermiiService.sendMailWithTermii(user.email || user.username || '', otp.toString());

    if (!mailResult.status) {
        return next(new AppError('Failed to send OTP via mail', 500));
    }

    return sendSuccess(res, 200, 'Withdrawal OTP sent successfully');
});

/**
 * Get all patron plans
 */
export const getPlans = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const plans = await (prisma as any).patronPlan.findMany({
        orderBy: { minAmount: 'asc' }
    });

    return sendSuccess(res, 200, 'Patron plans retrieved successfully', plans);
});
