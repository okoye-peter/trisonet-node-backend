import { Response } from 'express';

(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

interface ResponsePayload {
    status: 'success' | 'error';
    message: string;
    data: any;
    meta?: PaginationMeta;
}

export const sendSuccess = (res: Response, statusCode: number, message: string, data: any = null) => {
    const payload: ResponsePayload = {
        status: 'success',
        message,
        data,
    };
    return res.status(statusCode).json(payload);
};

export const sendPaginated = (res: Response, statusCode: number, message: string, data: any[], meta: PaginationMeta) => {
    const payload: ResponsePayload = {
        status: 'success',
        message,
        data,
        meta,
    };
    return res.status(statusCode).json(payload);
};
