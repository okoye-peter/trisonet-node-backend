import { prisma } from "../config/prisma";

class NotificationService {
    /**
     * Create a notification and associate it with one or more users
     */
    static async createNotification(userIds: bigint[], title: string, body: string) {
        return await prisma.$transaction(async (tx) => {
            const notification = await tx.notification.create({
                data: {
                    title,
                    body,
                }
            });

            await tx.notificationUser.createMany({
                data: userIds.map(userId => ({
                    userId,
                    notificationId: notification.id,
                    status: false
                }))
            });

            return notification;
        });
    }

    /**
     * Get notifications for a specific user
     */
    static async getUserNotifications(userId: bigint, limit: number = 20, offset: number = 0) {
        const notifications = await prisma.notificationUser.findMany({
            where: { userId },
            include: {
                notification: true
            },
            orderBy: {
                notification: {
                    createdAt: 'desc'
                }
            },
            take: limit,
            skip: offset
        });

        const unreadCount = await prisma.notificationUser.count({
            where: {
                userId,
                status: false
            }
        });

        return {
            notifications: notifications.map(n => ({
                id: n.notification.id,
                title: n.notification.title,
                body: n.notification.body,
                status: n.status,
                createdAt: n.notification.createdAt,
                updatedAt: n.notification.updatedAt
            })),
            unreadCount
        };
    }

    /**
     * Mark a single notification as read for a user
     */
    static async markAsRead(userId: bigint, notificationId: bigint) {
        return await prisma.notificationUser.updateMany({
            where: {
                userId,
                notificationId
            },
            data: {
                status: true
            }
        });
    }

    /**
     * Mark all notifications as read for a user
     */
    static async markAllAsRead(userId: bigint) {
        return await prisma.notificationUser.updateMany({
            where: { userId, status: false },
            data: {
                status: true
            }
        });
    }
}

export default NotificationService;
