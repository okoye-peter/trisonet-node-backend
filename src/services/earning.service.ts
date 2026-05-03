import { prisma } from "../config/prisma";
import { paginate, PaginateOptions } from "../utils/pagination";
import { getSafeUserWallets } from "../utils/prismaUtils";

class EarningService {
    static async getEarningTransactions(userId: bigint, options: PaginateOptions & { search?: string, type?: string }) {
        // 1. Get all wallets belonging to the user
        const wallets = await getSafeUserWallets(userId);

        const walletIds = wallets.map((wallet: any) => Number(wallet.id));

        // 2. Build where clause
        const where: any = {
            walletId: { in: walletIds }
        };

        if (options.search) {
            where.reference = { contains: options.search };
        }

        if (options.type && options.type !== 'all') {
            where.type = options.type;
        }

        // 3. Fetch paginated earning transactions for these wallets
        return await paginate(
            prisma.earningTransaction,
            {
                where,
                orderBy: {
                    createdAt: 'desc'
                }
            },
            options
        );
    }

    static async verifyPin(rawPin: string, hashedPin: string): Promise<boolean> {
        const bcrypt = await import('bcryptjs');
        return await bcrypt.default.compare(rawPin, hashedPin);
    }
}

export default EarningService;
