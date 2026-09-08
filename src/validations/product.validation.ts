import { z } from "zod";

export const listProductsSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).optional(),
        search: z.string().optional(),
        categoryId: z.string().regex(/^\d+$/, 'Invalid category id').optional(),
    }),
});

export const getProductSchema = z.object({
    params: z.object({
        id: z.string().regex(/^\d+$/, 'Invalid product id'),
    }),
});
