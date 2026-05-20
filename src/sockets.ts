import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from './config/prisma';

export let socketIOInstance: SocketIOServer | null = null;

export const getIO = (): SocketIOServer => {
    if (!socketIOInstance) {
        throw new Error('Socket.io has not been initialized');
    }
    return socketIOInstance;
};

export const setupSockets = (io: SocketIOServer) => {
    socketIOInstance = io;

    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { id: string };
            socket.data.userId = decoded.id;
            next();
        } catch (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', async (socket) => {
        const userId = socket.data.userId;
        const userBigIntId = BigInt(userId);

        console.log(`[Socket.io] User connected: ${userId} (Socket: ${socket.id})`);

        // Join private user room
        socket.join(`user:${userId}`);

        // Query database to join user to all active group chat rooms
        try {
            const userGroups = await prisma.chatGroupUser.findMany({
                where: { userId: userBigIntId },
                select: { chatGroupId: true }
            });

            userGroups.forEach((group) => {
                const groupIdStr = group.chatGroupId.toString();
                socket.join(`group:${groupIdStr}`);
                console.log(`[Socket.io] User ${userId} joined room group:${groupIdStr}`);
            });
        } catch (err) {
            console.error(`[Socket.io] Error joining group rooms for user ${userId}:`, err);
        }

        socket.on('disconnect', () => {
            console.log(`[Socket.io] User disconnected: ${userId} (Socket: ${socket.id})`);
        });
    });
};
