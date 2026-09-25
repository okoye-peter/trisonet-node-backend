import { z } from "zod";

export const saveSellerStoreSchema = z.object({
    body: z.object({
        name: z.string().trim().min(2, 'Store name is required').max(255),
        description: z.string().trim().min(10, 'Tell buyers a little about your store (at least 10 characters)').max(5000),
        // Uploaded first through POST /api/uploads, which returns { url, public_id }.
        logo: z.string().url('Store logo is required'),
        logoPublicId: z.string().max(255).optional(),
        phone: z.string().trim().min(7, 'A valid phone number is required').max(20),
        address: z.string().trim().min(5, 'Store address is required').max(2000),
        stateId: z.string().regex(/^\d+$/, 'Invalid state').optional(),
    }),
});

const productIdParams = z.object({
    id: z.string().regex(/^\d+$/, 'Invalid product id'),
});

export const sellerProductBody = z.object({
    name: z.string().trim().min(2, 'Product name is required').max(255),
    description: z.string().trim().min(10, 'Describe your product (at least 10 characters)').max(10000),
    price: z.coerce.number().positive('Price must be greater than zero').max(100_000_000),
    quantity: z.coerce.number().int().min(0, 'Stock cannot be negative').max(1_000_000),
    categoryId: z.string().regex(/^\d+$/, 'Choose a category'),
    isReturnable: z.boolean().default(true),
    // Uploaded first through POST /api/uploads. The first image is the default one.
    images: z.array(z.object({
        url: z.string().url('Invalid image'),
        publicId: z.string().max(255).optional(),
    })).min(1, 'Add at least one product image').max(8, 'You can add up to 8 images'),
});

export const listSellerProductsSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        search: z.string().trim().max(100).optional(),
    }),
});

export const sellerProductIdSchema = z.object({
    params: productIdParams,
});

export const createSellerProductSchema = z.object({
    body: sellerProductBody,
});

export const updateSellerProductSchema = z.object({
    params: productIdParams,
    body: sellerProductBody,
});

const orderRefParams = z.object({
    refNo: z.string().trim().min(1).max(255),
});

export const listSellerOrdersSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
        status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional(),
        search: z.string().trim().max(100).optional(),
    }),
});

export const sellerOrderRefSchema = z.object({
    params: orderRefParams,
});

// Sellers can only mark an order shipped, naming the courier so an admin can call them to
// confirm delivery. Delivered and cancelled are admin-only (PHP OrderGroupController@updateStatus).
export const updateSellerOrderStatusSchema = z.object({
    params: orderRefParams,
    body: z.object({
        status: z.literal('shipped'),
        courierName: z.string({ error: 'courier name is required' }).trim().min(2, 'courier name is required').max(100),
        courierPhone: z.string({ error: 'courier phone number is required' }).trim()
            .regex(/^\+?[0-9][0-9\s-]{6,18}[0-9]$/, 'enter a valid courier phone number'),
    }),
});
