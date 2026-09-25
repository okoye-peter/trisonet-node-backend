/**
 * Local-testing helper: places a paid order for a seller store's product through the
 * real confirmation path (PaymentService.processShopOrderPayment), exactly as if the
 * Paga webhook had confirmed it. This creates the order group, payout row, stock
 * decrement and the seller's in-app/email/SMS notifications.
 *
 * Skips only the Paga virtual-account call made at checkout.
 *
 * Usage: npx tsx scripts/seed-test-seller-order.ts <productId>[:qty] [<productId>[:qty] ...]
 * Mixing platform and partner products exercises the per-seller order split.
 */
import 'dotenv/config';
import { prisma } from '../src/config/prisma.js';
import { PaymentService } from '../src/services/payment.service.js';
import { mailWorker, smsWorker, referralWorker } from '../src/queue/index.js';

// Importing the queue module starts workers in this process too; stop them so the
// running backend's workers deliver the notifications, not this short-lived script.
await Promise.all([mailWorker.close(), smsWorker.close(), referralWorker.close()]);

const pairs = process.argv.slice(2);
if (pairs.length === 0) {
    console.error('Usage: npx tsx scripts/seed-test-seller-order.ts <productId>[:qty] [<productId>[:qty] ...]');
    process.exit(1);
}

const items = [];
for (const pair of pairs) {
    const [id, qty] = pair.split(':');
    const product = await prisma.product.findUnique({ where: { id: BigInt(id!) } });
    if (!product) throw new Error(`Product ${id} not found`);
    items.push({ productId: product.id.toString(), quantity: Number(qty ?? 1), price: parseFloat(product.price), name: product.name, image: product.image });
}
const amount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

const stamp = Date.now();
const pending = await prisma.pendingShopOrder.create({
    data: {
        guestName: 'Test Buyer',
        guestEmail: 'test-buyer@example.com',
        guestPhone: '+2348000000000',
        refNo: `ORD-${stamp}-TEST`,
        paymentReference: `ORDER-TEST-${stamp}`,
        amount,
        items,
        shipping: {
            fullName: 'Test Buyer',
            phone: '+2348000000000',
            address: '12 Test Street',
            city: 'Ikeja',
            state: 'Lagos',
            paymentMethod: 'paga',
        },
    },
});

const result = await new PaymentService().processShopOrderPayment({
    externalReferenceNumber: pending.paymentReference,
    paymentAmount: amount,
});

const groups = await prisma.orderGroup.findMany({
    where: { pendingShopOrderId: pending.id },
    select: { id: true, refNo: true, status: true, sellerStoreId: true },
});
console.log('confirmation result:', result);
console.log('order groups:', groups.map((g) => ({ ...g, id: g.id.toString(), sellerStoreId: g.sellerStoreId?.toString() })));

await prisma.$disconnect();
process.exit(0);
