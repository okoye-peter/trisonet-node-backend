import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma.js";
import { ROLES } from "../config/constants.js";
import WalletService from "../services/wallet.service.js";
import { AUCTION_ALLOWLIST_SETTING_KEY } from "../utils/auctionAccess.js";

function randomPassword(): string {
    return crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12) + "!1";
}

const TEST_USERS = [
    { name: "Auction Tester One", username: "auction_tester_1", email: "auction.tester1@trisonet.test" },
    { name: "Auction Tester Two", username: "auction_tester_2", email: "auction.tester2@trisonet.test" },
];

async function main() {
    const created: { email: string; username: string; password: string; id: string }[] = [];

    for (const candidate of TEST_USERS) {
        const password = randomPassword();
        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await prisma.user.create({
            data: {
                name: candidate.name,
                username: candidate.username,
                email: candidate.email,
                password: hashedPassword,
                level: 2,
                status: true,
                isInfant: false,
                accountState: 1,
            },
        });

        await WalletService.createWallets(user.id, ROLES.CUSTOMER);

        created.push({
            email: candidate.email,
            username: candidate.username,
            password,
            id: user.id.toString(),
        });
    }

    const allowedIds = created.map((u) => u.id).join(",");

    await prisma.setting.upsert({
        where: { key: AUCTION_ALLOWLIST_SETTING_KEY },
        create: {
            name: "Comma-separated user IDs allowed to access the GKWTH auction feature during live testing",
            key: AUCTION_ALLOWLIST_SETTING_KEY,
            dataType: "string",
            value: allowedIds,
        },
        update: {
            value: allowedIds,
        },
    });

    console.log("\n=== Auction test accounts created ===");
    for (const u of created) {
        console.log(`id=${u.id}  email=${u.email}  username=${u.username}  password=${u.password}`);
    }
    console.log(`\nSetting "${AUCTION_ALLOWLIST_SETTING_KEY}" set to: ${allowedIds}`);
    console.log("Note: wallets were created with a 0 GKWTH balance — fund them separately if you need to test creating a listing, not just browsing/bidding.\n");
}

main()
    .catch((error) => {
        console.error("Failed to create auction test users:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
