import "dotenv/config";
import { prisma } from "../config/prisma.js";

const ORDER_GROUP_ID = 25n;

async function main() {
    const group = await prisma.orderGroup.findUniqueOrThrow({
        where: { id: ORDER_GROUP_ID },
        include: { orderItems: { include: { product: true } }, orderTransactions: true },
    });

    const items = group.orderItems.map((item) => ({
        productId: item.productId.toString(),
        quantity: item.quantity,
        price: Number(item.price),
        name: item.product.name,
        image: item.product.image,
    }));

    const amount = group.orderTransactions[0]?.amount ?? items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const shippingAddress = JSON.parse(group.address);

    const pending = await prisma.pendingShopOrder.create({
        data: {
            userId: group.userId!,
            refNo: group.refNo,
            paymentReference: `LINK-${group.refNo}`,
            amount,
            items,
            shipping: { ...shippingAddress, paymentMethod: "paga" },
            status: "paid",
            orderGroupId: group.id,
            confirmedAt: new Date(),
        },
    });

    console.log("Linked PendingShopOrder:", {
        pendingId: pending.id.toString(),
        refNo: pending.refNo,
        orderGroupId: group.id.toString(),
    });
}

main()
    .catch((error) => {
        console.error("Failed to link pending shop order:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
