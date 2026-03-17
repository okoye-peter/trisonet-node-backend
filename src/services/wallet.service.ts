import { prisma } from "../config/prisma";
import { ROLES } from "../config/constants";
import { WalletType } from "../generated/prisma/enums";

class WalletService {
    static async createWallets(userId: bigint, role: number) {
        const data: { userId: bigint; type: WalletType }[] = [];

        if (role == ROLES.CUSTOMER) {
            data.push({ userId, type: WalletType.direct });
            data.push({ userId, type: WalletType.indirect });
        }

        await prisma.wallet.createMany({
            data,
        });
    }
}

export default WalletService;