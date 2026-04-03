
import { prisma } from '../config/prisma.js';

async function fixWallets() {
  try {
    console.log('Searching for wallets with invalid types...');
    
    // 1. Identify invalid wallets
    const invalidWallets = await prisma.$queryRaw`SELECT id, type, user_id FROM wallets WHERE type = ''`;
    console.log(`Found ${Array.isArray(invalidWallets) ? invalidWallets.length : 0} wallets with type = ''`);

    if (Array.isArray(invalidWallets) && invalidWallets.length > 0) {
      // 2. Fix them by setting type to NULL (which is allowed for optional type)
      // or set to a default enum value if NULL is not desired.
      // Given the schema 'type WalletType?', NULL is valid.
      const result = await prisma.$executeRaw`UPDATE wallets SET type = NULL WHERE type = ''`;
      console.log(`Updated ${result} wallets. Fixed invalid enum values.`);
    } else {
      console.log('No wallets with empty string type found.');
    }

  } catch (error) {
    console.error('Error during wallet cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixWallets();
