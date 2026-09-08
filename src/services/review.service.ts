import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { paginate } from "../utils/pagination";

interface CreateReviewInput {
    orderItemId: string;
    rating: number;
    comment?: string;
}

const serializeReview = (r: any) => ({
    id: r.id.toString(),
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    reviewerName: r.user?.name ?? 'Anonymous',
});

export const getProductReviews = async (productId: string, page?: number, limit?: number) => {
    const where = { productId: BigInt(productId) };

    const [result, summary] = await Promise.all([
        paginate(
            prisma.productReview,
            {
                where,
                include: { user: true },
                orderBy: { createdAt: 'desc' as const },
            },
            { page, limit },
        ),
        prisma.productReview.aggregate({
            where,
            _avg: { rating: true },
            _count: { _all: true },
        }),
    ]);

    return {
        ...result,
        data: result.data.map(serializeReview),
        summary: {
            average: summary._avg.rating ? Number(summary._avg.rating.toFixed(1)) : 0,
            count: summary._count._all,
        },
    };
};

// Order items the buyer has received (OrderGroup.deliveredAt is set by the PHP
// admin panel) and hasn't already reviewed — surfaced as "write a review" prompts.
export const getReviewableOrderItems = async (userId: bigint) => {
    const items = await prisma.orderItem.findMany({
        where: {
            orderGroup: { userId, deliveredAt: { not: null } },
            review: null,
        },
        include: {
            product: true,
            orderGroup: { select: { refNo: true, deliveredAt: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => ({
        orderItemId: item.id.toString(),
        productId: item.productId.toString(),
        productName: item.product.name,
        productImage: item.product.image,
        orderRefNo: item.orderGroup.refNo,
        deliveredAt: item.orderGroup.deliveredAt,
    }));
};

export const createReview = async (userId: bigint, payload: CreateReviewInput) => {
    const orderItem = await prisma.orderItem.findUnique({
        where: { id: BigInt(payload.orderItemId) },
        include: { orderGroup: true, review: true },
    });

    if (!orderItem || orderItem.orderGroup.userId !== userId) {
        throw new AppError('Order item not found', 404);
    }

    if (!orderItem.orderGroup.deliveredAt) {
        throw new AppError('You can only review products after your order has been delivered', 400);
    }

    if (orderItem.review) {
        throw new AppError('You have already reviewed this product', 409);
    }

    const review = await prisma.productReview.create({
        data: {
            productId: orderItem.productId,
            userId,
            orderItemId: orderItem.id,
            rating: payload.rating,
            comment: payload.comment || null,
        },
        include: { user: true },
    });

    return serializeReview(review);
};
