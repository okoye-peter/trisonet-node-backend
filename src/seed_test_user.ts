import { PrismaClient } from './generated/prisma';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const email = 'okoyep98@gmail.com';
    const password = 'password';
    const hashedPassword = await bcrypt.hash(password, 10);

    const existingUser = await prisma.user.findFirst({
        where: { email },
    });

    if (existingUser) {
        console.log('User already exists. Updating password...');
        await prisma.user.update({
            where: { id: existingUser.id },
            data: { password: hashedPassword },
        });
        console.log('User password updated.');
    } else {
        console.log('User does not exist. Creating...');
        await prisma.user.create({
            data: {
                name: 'Test User',
                email,
                password: hashedPassword,
                username: 'testuser',
                role: 3, // Default role
            },
        });
        console.log('User created successfully.');
    }
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
