import { z } from 'zod';

export const deleteFileSchema = z.object({
    body: z.object({
        url: z.string().url('Please provide a valid file URL to delete'),
    }),
});
