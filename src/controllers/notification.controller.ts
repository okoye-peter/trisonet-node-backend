import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { AppError } from "../utils/AppError";
import NotificationService from "../services/notification.service";

export const getNotifications = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user.id;
    const { limit, offset } = req.query;

    const data = await NotificationService.getUserNotifications(
        userId,
        limit ? parseInt(limit as string) : 20,
        offset ? parseInt(offset as string) : 0
    );

    sendSuccess(res, 200, 'Notifications fetched successfully', {
        ...data,
        notifications: data.notifications.map((n: any) => ({
            ...n,
            id: n.id.toString()
        }))
    });
});

export const markRead = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user.id;
    const { id } = req.params;
    if (!id) {
        return next(new AppError('Notification ID is required', 400));
    }
    const notificationId = BigInt(id as string);

    await NotificationService.markAsRead(userId, notificationId);

    sendSuccess(res, 200, 'Notification marked as read');
});

export const markAllRead = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user.id;

    await NotificationService.markAllAsRead(userId);

    sendSuccess(res, 200, 'All notifications marked as read');
});
