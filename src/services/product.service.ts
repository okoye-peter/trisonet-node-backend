import { prisma } from "../config/prisma";
import { paginate } from "../utils/pagination";
import { AppError } from "../utils/AppError";
import { PRODUCT_STATUS, SELLER_STORE_STATUS } from "../config/constants";

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
        // null = sold by Trisonet itself
        seller: p.sellerStore
            ? { id: p.sellerStore.id.toString(), name: p.sellerStore.name, logo: p.sellerStore.logo }
            : null,
    };
};

// A product is buyable only while it's approved AND, for a partner's product, its store
// is approved too - a suspended (or otherwise unapproved) store's products disappear.
// Also used by order.service.ts at checkout.
export const buyableProductWhere = {
    status: PRODUCT_STATUS.APPROVED,
    OR: [{ sellerStoreId: null }, { sellerStore: { status: SELLER_STORE_STATUS.APPROVED } }],
};

export const isBuyable = (p: { status: number; sellerStoreId: bigint | null; sellerStore?: { status: number } | null }) =>
    p.status === PRODUCT_STATUS.APPROVED &&
    (p.sellerStoreId === null || p.sellerStore?.status === SELLER_STORE_STATUS.APPROVED);

const sellerStoreInclude = { select: { id: true, name: true, logo: true, status: true, userId: true } };

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

type Viewer = { id: bigint } | null | undefined;

/** A partner never sees (or buys - see order.service.ts) their own store's products in the shop. */
const isOwnProduct = (p: { sellerStore?: { userId: bigint } | null }, viewer: Viewer) =>
    !!viewer && p.sellerStore?.userId === viewer.id;

export const listProducts = async ({ page, limit, search, categoryId }: ListProductsOptions, viewer?: Viewer) => {
    const where: any = { ...buyableProductWhere };
    if (viewer) where.AND = [{ OR: [{ sellerStoreId: null }, { sellerStore: { userId: { not: viewer.id } } }] }];
    if (search) where.name = { contains: search };
    if (categoryId) where.categoryId = BigInt(categoryId);

    const result = await paginate(
        prisma.product,
        {
            where,
            include: { category: true, images: productImagesInclude, reviews: productReviewRatingsInclude, sellerStore: sellerStoreInclude },
            orderBy: { createdAt: 'desc' },
        },
        { page, limit },
    );

    return {
        ...result,
        data: result.data.map(serializeProduct),
    };
};

export const getProductById = async (id: string, viewer?: Viewer) => {
    const product = await prisma.product.findUnique({
        where: { id: BigInt(id) },
        include: { category: true, images: productImagesInclude, reviews: productReviewRatingsInclude, sellerStore: sellerStoreInclude },
    });

    if (!product || !isBuyable(product) || isOwnProduct(product, viewer)) {
        throw new AppError('Product not found', 404);
    }

    return serializeProduct(product);
};
