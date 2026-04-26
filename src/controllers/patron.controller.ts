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

const pagaService = new PagaService();

/**
 * Get Patron Dashboard Data
 * Returns organization details, members, and transactions
 */
export const getDashboard = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user.patronGroupId) {
        return sendSuccess(res, 200, 'No organization found', { patronGroup: null });
    }

    const patronGroup = await prisma.patronGroup.findUnique({
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
            _count: {
                select: {
                    users: true,
                }
            }
        }
    });

    if (!patronGroup) {
        return next(new AppError('Patron group not found', 404));
    }

    // Get all patron IDs in this group to count total beneficiaries
    const groupMembers = await prisma.user.findMany({
        where: { patronGroupId: patronGroup.id, role: ROLES.PATRON },
        select: { id: true }
    });
    const memberIds = groupMembers.map(m => m.id);

    const totalBeneficiaries = await prisma.user.count({
        where: { patronId: { in: memberIds } }
    });

    // Get group balance
    const credits = await prisma.patronGroupTransaction.aggregate({
        where: { patronGroupId: patronGroup.id, type: 'credit' },
        _sum: { amount: true }
    });
    const debits = await prisma.patronGroupTransaction.aggregate({
        where: { patronGroupId: patronGroup.id, type: 'debit' },
        _sum: { amount: true }
    });
    const balance = (Number(credits._sum.amount) || 0) - (Number(debits._sum.amount) || 0);

    // Get members (patrons)
    const page = Number(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const [members, totalMembers] = await Promise.all([
        prisma.user.findMany({
            where: { patronGroupId: patronGroup.id, role: ROLES.PATRON },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                createdAt: true,
                _count: {
                    select: { patronees: true } // Beneficiaries
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.user.count({ where: { patronGroupId: patronGroup.id, role: ROLES.PATRON } })
    ]);

    // Get transactions
    const [transactions, totalTransactions] = await Promise.all([
        prisma.patronGroupTransaction.findMany({
            where: { patronGroupId: patronGroup.id },
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

    return sendSuccess(res, 200, 'Dashboard data retrieved successfully', {
        patronGroup: {
            ...patronGroup,
            balance,
        },
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

    if (!user.patronGroupId) {
        return sendSuccess(res, 200, 'No organization found', { members: [] });
    }

    const page = Number(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const where: any = {
        patronGroupId: user.patronGroupId,
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

    if (!user.patronGroupId) {
        return sendSuccess(res, 200, 'No organization found', { beneficiaries: [] });
    }

    const page = Number(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    let beneficiaryFilter: any;

    if (user.patronId) {
        // Current user is a member, show only their direct beneficiaries
        beneficiaryFilter = { patronId: user.id };
    } else {
        // Current user is a leader, show their direct beneficiaries + members' beneficiaries
        // Get all members in this group
        const members = await prisma.user.findMany({
            where: { patronGroupId: user.patronGroupId, role: ROLES.PATRON },
            select: { id: true }
        });
        const memberIds = members.map(m => m.id);
        
        // Include the leader's own ID in the filter
        beneficiaryFilter = { patronId: { in: [...memberIds, user.id] } };
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
    const { name, amount } = req.body;

    if (user.role !== ROLES.PATRON || user.patronGroupId) {
        return next(new AppError('You are not authorized to create a patron group or already belong to one', 403));
    }

    if (amount < 1000000) {
        return next(new AppError('Amount must be at least 1,000,000', 400));
    }

    // Logic for card debit or virtual account generation would go here
    // For now, following PHP logic but creating the group directly as if payment succeeded
    
    const charge = 50000;
    const reference = `TRISO-PG-${crypto.randomUUID()}`;

    const patronGroup = await prisma.$transaction(async (tx) => {
        const group = await tx.patronGroup.create({
            data: {
                name: name.toLowerCase(),
                userId: user.id
            }
        });

        await tx.patronGroupTransaction.create({
            data: {
                patronGroupId: group.id,
                amount: amount,
                charge: charge,
                type: 'credit',
                userId: user.id,
                reference,
                description: 'Patron group creation'
            }
        });

        await tx.user.update({
            where: { id: user.id },
            data: { patronGroupId: group.id }
        });

        return group;
    });

    return sendSuccess(res, 201, 'Patron group created successfully', patronGroup);
});

/**
 * Add a new patron member to the group
 */
export const addMember = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { name, email, phone, password: providedPassword } = req.body;

    // Only leaders (patrons without a patronId) can add members
    if (!user.patronGroupId || user.role !== ROLES.PATRON || user.patronId) {
        return next(new AppError('Unauthorized. Only organization leaders can add members.', 403));
    }

    const patronGroup = await prisma.patronGroup.findUnique({
        where: { id: user.patronGroupId }
    });

    if (!patronGroup || patronGroup.userId !== user.id) {
        return next(new AppError('Unauthorized to manage this group', 403));
    }

    const memberCount = await prisma.user.count({
        where: { patronGroupId: patronGroup.id }
    });

    if (memberCount >= MAX_PATRONS_PER_GROUP) {
        return next(new AppError('Maximum number of patrons reached for this organization', 400));
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
                patronGroupId: patronGroup.id,
                password: hashedPassword,
                status: true,
                accountState: 1
            }
        });

        // Create direct wallet for the member
        await tx.wallet.create({
            data: {
                userId: createdUser.id,
                type: 'direct',
                amount: 0
            }
        });

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
    const credits = await prisma.patronGroupTransaction.aggregate({
        where: { patronGroupId: patronGroup.id, type: 'credit' },
        _sum: { amount: true }
    });
    const debits = await prisma.patronGroupTransaction.aggregate({
        where: { patronGroupId: patronGroup.id, type: 'debit' },
        _sum: { amount: true }
    });
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
                walletId: wallet.id
            }
        });

        return groupTx;
    });

    return sendSuccess(res, 200, 'Member credited successfully', transaction);
});

/**
 * Initiate Funding for the Organization Wallet
 */
export const initiateFunding = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const { amount } = req.body;

    if (!user.patronGroupId || user.role !== ROLES.PATRON) {
        return next(new AppError('Unauthorized', 403));
    }

    const patronGroup = await prisma.patronGroup.findUnique({
        where: { id: user.patronGroupId }
    });

    if (!patronGroup || patronGroup.userId !== user.id) {
        return next(new AppError('Unauthorized to manage this group', 403));
    }

    if (amount < 1000) {
        return next(new AppError('Amount must be at least 1,000', 400));
    }

    // Get the group's wallet
    const wallet = await prisma.wallet.findFirst({
        where: { userId: user.id, type: 'direct' } // Groups use the owner's direct wallet for funding
    });

    if (!wallet) {
        return next(new AppError('Organization wallet not found', 404));
    }

    const reference = `PATRON-FUND-${crypto.randomUUID()}`;
    
    // Generate Paga Virtual Account
    const pagaResult = await pagaService.generateVirtualAccount(
        amount,
        patronGroup.name,
        user.phone,
        reference
    );

    if (!pagaResult.success) {
        return next(new AppError(pagaResult.error || 'Failed to generate payment account', 500));
    }

    // Record the pending funding
    await prisma.manuallyFunding.create({
        data: {
            walletId: wallet.id,
            amount: amount.toString(),
            receipt: reference,
        }
    });

    return sendSuccess(res, 200, 'Funding initiated successfully', pagaResult.data);
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
