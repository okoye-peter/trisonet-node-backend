import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";
import { User } from "../config/prisma";
import * as OrderService from "../services/order.service";

// These two routes sit behind optionalAuth (not protect), so req.user may genuinely
// be absent — a guest checking out or looking up their order.
const optionalUser = (req: Request): User | undefined => req.user;

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
    const user = optionalUser(req);
    const { items, shipping } = req.body;

    if (user) {
        const order = await OrderService.createOrder(user.id, { items, shipping }, { name: user.name, email: user.email, username: user.username });
        return sendSuccess(res, 201, 'Order placed successfully', order);
    }

    if (!shipping.email) {
        throw new AppError('An email address is required to check out as a guest', 400);
    }

    const order = await OrderService.createGuestOrder(
        { items, shipping },
        { name: shipping.fullName, email: shipping.email, phone: shipping.phone }
    );

    sendSuccess(res, 201, 'Order placed successfully', order);
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
    const user = optionalUser(req);
    const order = user
        ? await OrderService.getOrderByRefNo(req.params.refNo as string, user.id)
        : await OrderService.getGuestOrderByRefNo(req.params.refNo as string, requireGuestEmail(req));

    sendSuccess(res, 200, 'Order fetched successfully', order);
});

export const getOrderStatus = asyncHandler(async (req: Request, res: Response) => {
    const user = optionalUser(req);
    const status = user
        ? await OrderService.getOrderStatus(req.params.refNo as string, user.id)
        : await OrderService.getGuestOrderStatus(req.params.refNo as string, requireGuestEmail(req));

    sendSuccess(res, 200, 'Order status fetched', status);
});

function requireGuestEmail(req: Request): string {
    const email = req.query.email as string | undefined;
    if (!email) {
        throw new AppError('An email address is required to look up a guest order', 400);
    }
    return email;
}

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
