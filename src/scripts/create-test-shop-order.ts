import "dotenv/config";
import { prisma } from "../config/prisma.js";
import { ORDER_GROUP_STATUSES } from "../config/constants.js";

async function main() {
    const user = await prisma.user.findFirst({
        where: { email: "shop.user@yopmail.com" },
    });

    if (!user) {
        throw new Error("User shop.user@yopmail.com not found");
    }

    const product = await prisma.product.findFirstOrThrow({
        where: { status: 1, quantity: { gt: 0 } },
        select: { id: true, name: true, price: true },
    });

    const refNo = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const quantity = 1;
    const price = Number(product.price);

    const orderGroup = await prisma.$transaction(async (tx) => {
        const group = await tx.orderGroup.create({
            data: {
                userId: user.id,
                status: ORDER_GROUP_STATUSES.PENDING,
                refNo,
                address: JSON.stringify({
                    fullName: user.name,
                    phone: user.phone,
                    address: "1 Test Street, Ikeja",
                    city: "Ikeja",
                    state: "Lagos",
                }),
            },
        });

        await tx.orderItem.create({
            data: {
                orderGroupId: group.id,
                productId: product.id,
                quantity,
                price,
            },
        });

        await tx.orderTransaction.create({
            data: {
                orderGroupId: group.id,
                paymentMethod: false,
                amount: price * quantity,
                paymentReference: `TEST-PAY-${refNo}`,
                paymentStatus: "paid",
                confirmedAt: new Date(),
            },
        });

        return group;
    });

    console.log("Created order:", {
        orderGroupId: orderGroup.id.toString(),
        refNo: orderGroup.refNo,
        status: orderGroup.status,
        userId: user.id.toString(),
        product: product.name,
    });
}

main()
    .catch((error) => {
        console.error("Failed to create test order:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
