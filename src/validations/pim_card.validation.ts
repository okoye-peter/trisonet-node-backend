import z from "zod";

export const cardPurchaseSchema = z.object({
    body: z.object({
        quantity: z.number().min(2, 'Quantity must be greater than 2'),
        amount: z.number(),
    })
})