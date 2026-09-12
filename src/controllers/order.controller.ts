import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import * as OrderService from "../services/order.service";

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const { items, shipping } = req.body;

    const order = await OrderService.createOrder(user.id, { items, shipping }, { name: user.name, email: user.email });

    sendSuccess(res, 201, 'Order placed successfully', order);
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const order = await OrderService.getOrderByRefNo(req.params.refNo as string, user.id);

    sendSuccess(res, 200, 'Order fetched successfully', order);
});

export const getOrderStatus = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const status = await OrderService.getOrderStatus(req.params.refNo as string, user.id);

    sendSuccess(res, 200, 'Order status fetched', status);
});

export const cancelOrder = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const { bankName, bankUUID, accountNumber } = req.body;

    const order = await OrderService.cancelOrder(req.params.refNo as string, user.id, { bankName, bankUUID, accountNumber });

    sendSuccess(res, 200, 'Order cancelled and refund sent to your bank account', order);
});

export const createReturn = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const { reason, orderItemIds, bankName, bankUUID, accountNumber } = req.body;

    const orderReturn = await OrderService.createReturn(req.params.refNo as string, user.id, {
        reason,
        orderItemIds,
        bankName,
        bankUUID,
        accountNumber,
    });

    sendSuccess(res, 201, 'Return request submitted — an admin will review it shortly', orderReturn);
});

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    const { page, limit, search, status, dateFrom, dateTo } = req.query;

    const orders = await OrderService.getOrdersForUser(user.id, Number(page) || undefined, Number(limit) || undefined, {
        search: search as string | undefined,
        shippingStatus: status as 'cancelled' | 'pending' | 'shipped' | 'delivered' | undefined,
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
    });

    sendSuccess(res, 200, 'Orders fetched successfully', orders);
});
