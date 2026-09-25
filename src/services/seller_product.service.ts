import { prisma, Prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { paginate } from "../utils/pagination";
import { PRODUCT_STATUS, SELLER_STORE_STATUS } from "../config/constants";
import { SellerStoreService } from "./seller_store.service";

export interface SellerProductInput {
    name: string;
    description: string;
    price: number;
    quantity: number;
    categoryId: string;
    isReturnable: boolean;
    images: { url: string; publicId?: string | undefined }[];
}

const STATUS_TEXT: Record<number, string> = {
    [PRODUCT_STATUS.PENDING]: 'pending',
    [PRODUCT_STATUS.APPROVED]: 'approved',
    [PRODUCT_STATUS.REJECTED]: 'rejected',
};

const STATUS_BY_TEXT: Record<string, number> = {
    pending: PRODUCT_STATUS.PENDING,
    approved: PRODUCT_STATUS.APPROVED,
    rejected: PRODUCT_STATUS.REJECTED,
};

const productInclude = {
    category: { select: { id: true, name: true, displayName: true } },
    images: { orderBy: [{ isDefault: 'desc' as const }, { sortOrder: 'asc' as const }] },
};

// What PHP's "What changed?" audit page (ProductReviewController::auditHistory) reads.
// Edits made through Laravel get these rows from owen-it/laravel-auditing automatically;
// seller edits come through here, so they're written by hand in the same shape.
const AUDIT_USER_TYPE = 'App\\Models\\User';
const AUDIT_PRODUCT_TYPE = 'App\\Models\\Product';

const serializeSellerProduct = (p: any) => ({
    id: p.id.toString(),
    name: p.name,
    description: p.description,
    price: parseFloat(p.price),
    quantity: p.quantity,
    isReturnable: p.isReturnable,
    categoryId: p.categoryId.toString(),
    category: p.category
        ? { id: p.category.id.toString(), name: p.category.name, displayName: p.category.displayName }
        : null,
    images: (p.images ?? []).map((img: any) => ({
        id: img.id.toString(),
        url: img.image,
        publicId: img.cloudinaryPublicId,
        isDefault: img.isDefault,
    })),
    status: STATUS_TEXT[p.status] ?? 'unknown',
    reviewComment: p.reviewComment,
    reviewedAt: p.reviewedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
});

const sameImages = (a: string[], b: string[]) => a.length === b.length && a.every((url, i) => url === b[i]);

export class SellerProductService {
    private static async getStore(user: any) {
        const store = await prisma.sellerStore.findUnique({ where: { userId: user.id } });
        if (!store) throw new AppError('You do not have a store yet', 403);
        return store;
    }

    /** Creating or editing products needs an approved (not pending/rejected/suspended) store. */
    private static async getApprovedStore(user: any) {
        SellerStoreService.assertEligible(user);
        const store = await this.getStore(user);
        if (store.status !== SELLER_STORE_STATUS.APPROVED) {
            throw new AppError(
                store.status === SELLER_STORE_STATUS.SUSPENDED
                    ? 'Your store is suspended. Please contact support.'
                    : 'Your store must be approved before you can manage products',
                403,
            );
        }
        return store;
    }

    private static async getOwnProduct(storeId: bigint, productId: string) {
        const product = await prisma.product.findFirst({
            where: { id: BigInt(productId), sellerStoreId: storeId },
            include: productInclude,
        });
        if (!product) throw new AppError('Product not found', 404);
        return product;
    }

    private static async assertCategory(categoryId: string) {
        const category = await prisma.category.findUnique({ where: { id: BigInt(categoryId) }, select: { id: true } });
        if (!category) throw new AppError('Invalid category', 400);
    }

    static async list(
        user: any,
        { page, limit, status, search }: { page?: number | undefined; limit?: number | undefined; status?: string | undefined; search?: string | undefined },
    ) {
        const store = await this.getStore(user);
        const where: Prisma.ProductWhereInput = { sellerStoreId: store.id };
        if (status) where.status = STATUS_BY_TEXT[status]!;

        // Name match (MySQL collation makes it case-insensitive); an all-digit term also matches the product ID.
        const term = search?.trim();
        if (term) {
            where.OR = [{ name: { contains: term } }, ...(/^\d{1,18}$/.test(term) ? [{ id: BigInt(term) }] : [])];
        }

        const result = await paginate(
            prisma.product,
            { where, include: productInclude, orderBy: { updatedAt: 'desc' } },
            { page, limit },
        );
        return { ...result, data: result.data.map(serializeSellerProduct) };
    }

    static async get(user: any, productId: string) {
        const store = await this.getStore(user);
        return serializeSellerProduct(await this.getOwnProduct(store.id, productId));
    }

    static async create(user: any, input: SellerProductInput) {
        const store = await this.getApprovedStore(user);
        await this.assertCategory(input.categoryId);

        const [cover] = input.images;
        const product = await prisma.product.create({
            data: {
                name: input.name,
                description: input.description,
                price: input.price.toFixed(2),
                quantity: input.quantity,
                categoryId: BigInt(input.categoryId),
                isReturnable: input.isReturnable,
                image: cover!.url,
                cloudinaryPublicId: cover!.publicId ?? '',
                status: PRODUCT_STATUS.PENDING,
                sellerStoreId: store.id,
                createdBy: user.id,
                images: {
                    create: input.images.map((img, i) => ({
                        image: img.url,
                        cloudinaryPublicId: img.publicId ?? null,
                        isDefault: i === 0,
                        sortOrder: i,
                    })),
                },
            },
            include: productInclude,
        });

        return serializeSellerProduct(product);
    }

    /**
     * Full-replace edit. Changes that alter what a buyer is actually sold go back to admin
     * review (and the product leaves the storefront until approved):
     *   name, description, category, images (set or order), a price increase, and turning
     *   returns off.
     * Changes that can't hurt a buyer go live immediately, without review:
     *   stock quantity, a price decrease, and turning returns on.
     * A rejected product is never live, so any saved edit resubmits it for review.
     */
    static async update(user: any, productId: string, input: SellerProductInput) {
        const store = await this.getApprovedStore(user);
        const product = await this.getOwnProduct(store.id, productId);

        if (input.categoryId !== product.categoryId.toString()) {
            await this.assertCategory(input.categoryId);
        }

        const oldPrice = parseFloat(product.price);
        const oldImages = product.images.map((img) => img.image);
        const newImages = input.images.map((img) => img.url);
        const imagesChanged = !sameImages(oldImages, newImages);

        const needsReview =
            input.name !== product.name ||
            input.description !== product.description ||
            input.categoryId !== product.categoryId.toString() ||
            imagesChanged ||
            input.price > oldPrice ||
            (product.isReturnable && !input.isReturnable);

        // Old/new values for the audit trail, keyed by PHP column name.
        const oldValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};
        const track = (column: string, before: unknown, after: unknown) => {
            if (before !== after) {
                oldValues[column] = before;
                newValues[column] = after;
            }
        };
        track('name', product.name, input.name);
        track('description', product.description, input.description);
        track('price', oldPrice.toFixed(2), input.price.toFixed(2));
        track('quantity', product.quantity, input.quantity);
        track('category_id', product.categoryId.toString(), input.categoryId);
        track('is_returnable', product.isReturnable, input.isReturnable);
        if (imagesChanged) {
            const added = newImages.filter((url) => !oldImages.includes(url)).length;
            const removed = oldImages.filter((url) => !newImages.includes(url)).length;
            oldValues.images = `${oldImages.length} image(s)`;
            newValues.images = `${newImages.length} image(s) (${added} added, ${removed} removed${added === 0 && removed === 0 ? ', reordered' : ''})`;
        }

        if (Object.keys(newValues).length === 0) {
            throw new AppError('No changes to save', 400);
        }

        const sendToReview =
            product.status === PRODUCT_STATUS.REJECTED || (needsReview && product.status !== PRODUCT_STATUS.PENDING);
        const [cover] = input.images;

        const updated = await prisma.$transaction(async (tx) => {
            if (imagesChanged) {
                const keptIds = product.images.filter((img) => newImages.includes(img.image)).map((img) => img.id);
                await tx.productImage.deleteMany({ where: { productId: product.id, id: { notIn: keptIds } } });

                for (const [i, img] of input.images.entries()) {
                    const existing = product.images.find((e) => e.image === img.url);
                    if (existing) {
                        await tx.productImage.update({ where: { id: existing.id }, data: { isDefault: i === 0, sortOrder: i } });
                    } else {
                        await tx.productImage.create({
                            data: { productId: product.id, image: img.url, cloudinaryPublicId: img.publicId ?? null, isDefault: i === 0, sortOrder: i },
                        });
                    }
                }
            }

            const result = await tx.product.update({
                where: { id: product.id },
                data: {
                    name: input.name,
                    description: input.description,
                    price: input.price.toFixed(2),
                    quantity: input.quantity,
                    categoryId: BigInt(input.categoryId),
                    isReturnable: input.isReturnable,
                    image: cover!.url,
                    cloudinaryPublicId: cover!.publicId ?? product.images.find((e) => e.image === cover!.url)?.cloudinaryPublicId ?? '',
                    ...(sendToReview
                        ? { status: PRODUCT_STATUS.PENDING, reviewComment: null, reviewedBy: null, reviewedAt: null }
                        : {}),
                },
                include: productInclude,
            });

            await tx.audit.create({
                data: {
                    userType: AUDIT_USER_TYPE,
                    userId: user.id,
                    event: 'updated',
                    auditableType: AUDIT_PRODUCT_TYPE,
                    auditableId: product.id,
                    oldValues: JSON.stringify(oldValues),
                    newValues: JSON.stringify(newValues),
                    url: `api/seller/products/${product.id}`,
                    createdAt: new Date(),
                },
            });

            return result;
        });

        return { product: serializeSellerProduct(updated), sentForReview: needsReview || sendToReview };
    }

    /**
     * Only a product nobody has ordered can be deleted - order_items cascade on product
     * delete, so deleting an ordered product would erase it from buyers' order history.
     */
    static async remove(user: any, productId: string) {
        const store = await this.getStore(user);
        const product = await this.getOwnProduct(store.id, productId);

        const orderCount = await prisma.orderItem.count({ where: { productId: product.id } });
        if (orderCount > 0) {
            throw new AppError('This product has been ordered before and cannot be deleted. Set its stock to 0 to stop selling it.', 409);
        }

        // A checkout awaiting payment only becomes an order_items row once payment
        // confirms - deleting now would make that confirmation fail after the buyer paid.
        const [checkoutRow] = await prisma.$queryRaw<{ inCheckout: bigint }[]>`
            SELECT COUNT(*) AS inCheckout FROM pending_shop_orders
            WHERE status = 'pending'
              AND JSON_SEARCH(items, 'one', ${product.id.toString()}, NULL, '$[*].productId') IS NOT NULL`;
        if (Number(checkoutRow?.inCheckout ?? 0) > 0) {
            throw new AppError('Someone is checking out with this product right now. Set its stock to 0 instead, or try again later.', 409);
        }

        await prisma.product.delete({ where: { id: product.id } });
    }
}
