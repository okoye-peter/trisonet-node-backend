import "dotenv/config";
import { prisma } from "../config/prisma.js";

const CARD_CHARGE_SETTING_KEY = "auction_card_charge_percentage";
const DEFAULT_VALUE = "1.5";

async function main() {
    const setting = await prisma.setting.upsert({
        where: { key: CARD_CHARGE_SETTING_KEY },
        create: {
            name: "Card payment surcharge percentage for auction claim payments",
            key: CARD_CHARGE_SETTING_KEY,
            dataType: "number",
            value: DEFAULT_VALUE,
        },
        update: {},
    });

    console.log(`Setting '${setting.key}' = ${setting.value}`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
