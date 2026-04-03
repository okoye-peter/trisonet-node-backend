import { prisma } from './config/prisma.js';

async function checkWallets() {
  try {
    // We use $queryRaw because prisma.wallet.findMany will fail if there are invalid enum values
    const wallets = await prisma.$queryRaw`SELECT id, type, user_id FROM wallets WHERE type = '' OR type IS NULL`;
    console.log('Wallets with empty or null type:', wallets);
    
    const allTypes = await prisma.$queryRaw`SELECT DISTINCT type FROM wallets`;
    console.log('Distinct wallet types in DB:', allTypes);
  } catch (error) {
    console.error('Error checking wallets:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkWallets();
