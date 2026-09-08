import { prisma } from "../config/prisma";
import { paginate } from "../utils/pagination";
import { AppError } from "../utils/AppError";
import { PRODUCT_STATUS } from "../config/constants";

const serializeProduct = (p: any) => {
    const ratings = (p.reviews ?? []).map((r: any) => r.rating);
    const average = ratings.length
        ? Number((ratings.reduce((sum: number, r: number) => sum + r, 0) / ratings.length).toFixed(1))
        : 0;

    return {
        id: p.id.toString(),
        name: p.name,
        description: p.description,
        quantity: p.quantity,
        price: parseFloat(p.price),
        image: p.image,
        isReturnable: p.isReturnable,
        images: (p.images ?? []).map((img: any) => ({
            id: img.id.toString(),
            image: img.image,
            isDefault: img.isDefault,
        })),
        categoryId: p.categoryId.toString(),
        category: p.category
            ? {
                id: p.category.id.toString(),
                name: p.category.name,
                displayName: p.category.displayName,
            }
            : undefined,
        reviewSummary: { average, count: ratings.length },
    };
};

const productImagesInclude = {
    orderBy: [{ isDefault: 'desc' as const }, { sortOrder: 'asc' as const }],
};

const productReviewRatingsInclude = { select: { rating: true } };

interface ListProductsOptions {
    page?: number | undefined;
    limit?: number | undefined;
    search?: string | undefined;
    categoryId?: string | undefined;
}

export const listProducts = async ({ page, limit, search, categoryId }: ListProductsOptions) => {
    const where: any = { status: PRODUCT_STATUS.APPROVED };
    if (search) where.name = { contains: search };
    if (categoryId) where.categoryId = BigInt(categoryId);

    const result = await paginate(
        prisma.product,
        {
            where,
            include: { category: true, images: productImagesInclude, reviews: productReviewRatingsInclude },
            orderBy: { createdAt: 'desc' },
        },
        { page, limit },
    );

    return {
        ...result,
        data: result.data.map(serializeProduct),
    };
};

export const getProductById = async (id: string) => {
    const product = await prisma.product.findUnique({
        where: { id: BigInt(id) },
        include: { category: true, images: productImagesInclude, reviews: productReviewRatingsInclude },
    });

    if (!product || product.status !== PRODUCT_STATUS.APPROVED) {
        throw new AppError('Product not found', 404);
    }

    return serializeProduct(product);
};
