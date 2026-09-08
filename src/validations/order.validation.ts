import { z } from "zod";

export const createOrderSchema = z.object({
    body: z.object({
        items: z.array(z.object({
            productId: z.string().regex(/^\d+$/, 'Invalid product id'),
            quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
        })).min(1, 'Your cart is empty'),
        shipping: z.object({
            fullName: z.string().min(2, 'Full name is required'),
            phone: z.string().min(7, 'A valid phone number is required'),
            address: z.string().min(5, 'Delivery address is required'),
            city: z.string().min(2, 'City is required'),
            state: z.string().min(2, 'State is required'),
        }),
    }),
});

export const getOrderSchema = z.object({
    params: z.object({
        refNo: z.string().min(1, 'Order reference is required'),
    }),
});

export const listOrdersSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
});
