import "dotenv/config";
import { prisma } from "../config/prisma.js";

const COMMISSION_PERCENTAGE_KEY = "store_invite_commission_percentage";
const UPGRADE_WINDOW_HOURS_KEY = "store_invite_upgrade_window_hours";
const DEFAULT_COMMISSION_PERCENTAGE = "5";
const DEFAULT_UPGRADE_WINDOW_HOURS = "72";

async function main() {
    const commission = await prisma.setting.upsert({
        where: { key: COMMISSION_PERCENTAGE_KEY },
        create: {
            name: "Store Invite Commission (%)",
            key: COMMISSION_PERCENTAGE_KEY,
            dataType: "number",
            value: DEFAULT_COMMISSION_PERCENTAGE,
        },
        update: {},
    });

    const upgradeWindow = await prisma.setting.upsert({
        where: { key: UPGRADE_WINDOW_HOURS_KEY },
        create: {
            name: "Store Guest Upgrade Window (hours)",
            key: UPGRADE_WINDOW_HOURS_KEY,
            dataType: "number",
            value: DEFAULT_UPGRADE_WINDOW_HOURS,
        },
        update: {},
    });

    console.log(`Setting '${commission.key}' = ${commission.value}`);
    console.log(`Setting '${upgradeWindow.key}' = ${upgradeWindow.value}`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
