import { PrismaClient } from './src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
    console.log("Testing Prisma Search...");
    try {
        const search = "com"; // typical search string
        const whereClause: any = {};
        
        whereClause.OR = [
            { name: { contains: String(search) } },
            { email: { contains: String(search) } },
            { username: { contains: String(search) } }
        ];

        const users = await prisma.user.findMany({
            where: whereClause,
            take: 2,
        });

        console.log("Success! Found:", users.length, "users.");
    } catch (error) {
        console.error("Prisma Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
