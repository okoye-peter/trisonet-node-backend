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
            // Only required for guest checkout (no logged-in user) — see
            // OrderController.createOrder — but always accepted so an authenticated
            // buyer can optionally send a different contact email too.
            email: z.string().email('A valid email is required').optional(),
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
    query: z.object({
        // Required to look up a guest order (no account to scope by userId instead).
        email: z.string().email('A valid email is required').optional(),
    }).optional(),
});

export const cancelOrderSchema = z.object({
    params: z.object({
        refNo: z.string().min(1, 'Order reference is required'),
    }),
    body: z.object({
        bankName: z.string().min(1, 'Bank name is required'),
        bankUUID: z.string().uuid('Invalid bank'),
        accountNumber: z.string().min(10, 'Account number must be at least 10 digits long').max(10, 'Account number must be at most 10 digits long').regex(/^[0-9]+$/, 'Account number must contain only numbers'),
    }),
});

export const createReturnSchema = z.object({
    params: z.object({
        refNo: z.string().min(1, 'Order reference is required'),
    }),
    body: z.object({
        reason: z.string().min(1, 'A reason is required').max(1000),
        orderItemIds: z.array(z.string().regex(/^\d+$/, 'Invalid item id')).min(1, 'Select at least one item to return'),
        bankName: z.string().min(1, 'Bank name is required'),
        bankUUID: z.string().uuid('Invalid bank'),
        accountNumber: z.string().min(10, 'Account number must be at least 10 digits long').max(10, 'Account number must be at most 10 digits long').regex(/^[0-9]+$/, 'Account number must contain only numbers'),
    }),
});

export const listOrdersSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        search: z.string().trim().min(1).optional(),
        status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']).optional(),
        dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date').optional(),
        dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date').optional(),
    }),
});
