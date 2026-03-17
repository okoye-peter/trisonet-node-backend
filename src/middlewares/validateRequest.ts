import { Request, Response, NextFunction } from 'express';
import { ZodObject, ZodSchema, ZodError } from 'zod';
import { AppError } from '../utils/AppError';

export const validate = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            });
            return next();
        } catch (error) {
            if (error instanceof ZodError) {
                const message = error.issues.map((issue) => issue.message).join(', ');
                return next(new AppError(message, 400));
            }
            return next(error);
        }
    };
};
