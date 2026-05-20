import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../middlewares/asyncHandler";
import { AppError } from "../utils/AppError";
import { sendSuccess } from "../utils/responseWrapper";
import { getIO } from "../sockets";
import { deleteCloudinaryFileByUrl } from "../utils/cloudinaryHelper";

/**
 * Helper to serialize User object with picture_url and camelCase standard mapping.
 */
const serializeUser = (user: any) => {
    if (!user) return null;
    return {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        username: user.username,
        picture_url: user.pictureUrl || "uploads/default.png",
        pictureUrl: user.pictureUrl || "uploads/default.png",
        is_online: user.isOnline || false,
        last_seen: user.lastSeen || user.updatedAt,
    };
};

/**
 * Helper to serialize Message object matching legacy field expectations.
 */
const serializeMessage = (msg: any) => {
    if (!msg) return null;
    return {
        id: msg.id.toString(),
        sender_id: msg.senderId.toString(),
        receiver_id: msg.receiverId ? msg.receiverId.toString() : null,
        chat_group_id: msg.chatGroupId ? msg.chatGroupId.toString() : null,
        msg_body: msg.msgBody,
        msg_image: msg.msgImage,
        read_at: msg.readAt,
        created_at: msg.createdAt,
        updated_at: msg.updatedAt,
        user: serializeUser(msg.sender),
    };
};

// ─── Direct Private Messaging Controllers ──────────────────────────────────────

/**
 * Retrieves mutual followed contacts along with unread messages count.
 */
export const getUserFriends = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);

    // Get following list
    const following = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true }
    });

    // Get followers list
    const followers = await prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true }
    });

    const friendIds = Array.from(new Set([
        ...following.map(f => f.followingId),
        ...followers.map(f => f.followerId)
    ]));

    // Query User Details
    const usersList = await prisma.user.findMany({
        where: { id: { in: friendIds } },
        select: {
            id: true,
            name: true,
            email: true,
            username: true,
            pictureUrl: true,
            lastSeen: true,
            updatedAt: true
        }
    });

    // Query Unread Messages Count
    const unreadCounts = await prisma.message.groupBy({
        by: ['senderId'],
        where: {
            receiverId: userId,
            readAt: null
        },
        _count: {
            id: true
        }
    });

    const friends = usersList.map((friend) => {
        const unread = unreadCounts.find(u => u.senderId === friend.id);
        const unread_count = unread ? Number(unread._count.id) : 0;
        
        // Define is_online if user logged in or active in last 5 minutes
        const lastSeenTime = friend.lastSeen ? new Date(friend.lastSeen).getTime() : 0;
        const is_online = (Date.now() - lastSeenTime) < 5 * 60 * 1000;

        return {
            ...serializeUser(friend),
            unread_count,
            is_online
        };
    });

    sendSuccess(res, 200, "Friends loaded successfully", { friends, unread_count: unreadCounts });
});

/**
 * Retrieves direct messages history and groups them by date (YYYY-MM-DD).
 */
export const getChatWithFriend = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const friendId = BigInt(req.params.friendId as string);

    // Fetch messages excluding soft-deleted ones
    const messages = await prisma.message.findMany({
        where: {
            OR: [
                {
                    senderId: userId,
                    receiverId: friendId,
                    senderDeletedAt: null
                },
                {
                    senderId: friendId,
                    receiverId: userId,
                    receiverDeletedAt: null
                }
            ]
        },
        include: {
            sender: {
                select: { id: true, name: true, username: true, pictureUrl: true }
            }
        },
        orderBy: {
            createdAt: 'asc'
        }
    });

    // Mark received messages as read
    await prisma.message.updateMany({
        where: {
            senderId: friendId,
            receiverId: userId,
            readAt: null
        },
        data: {
            readAt: new Date()
        }
    });

    // Group messages by Date YYYY-MM-DD
    const groupedMessages: Record<string, any[]> = {};
    messages.forEach((msg) => {
        const dateStr = (msg.createdAt ? new Date(msg.createdAt).toISOString().split('T')[0] : 'unknown') || 'unknown';
        let group = groupedMessages[dateStr];
        if (!group) {
            group = [];
            groupedMessages[dateStr] = group;
        }
        group.push(serializeMessage(msg));
    });

    res.status(200).json(groupedMessages);
});

/**
 * Sends a direct message to a friend and broadcasts a real-time event.
 */
export const sendPrivateMessage = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const senderId = BigInt(user.id);
    const { receiver_id, msg_body } = req.body;

    if (!receiver_id || !msg_body) {
        return next(new AppError("Receiver ID and message body are required", 400));
    }

    const receiverId = BigInt(receiver_id);

    // Insert Message
    const message = await prisma.message.create({
        data: {
            senderId,
            receiverId,
            msgBody: msg_body
        },
        include: {
            sender: {
                select: { id: true, name: true, username: true, pictureUrl: true }
            }
        }
    });

    const serializedMsg = serializeMessage(message);
    const serializedSender = serializeUser(user);

    // Dispatch real-time Socket.io notification
    try {
        const io = getIO();
        io.to(`user:${receiverId.toString()}`).emit("UserSendMessagesEvent", {
            message: serializedMsg,
            friend: serializedSender
        });
    } catch (err) {
        console.error("Socket error dispatching private message:", err);
    }

    sendSuccess(res, 201, "Message sent successfully", { message: serializedMsg });
});

/**
 * Deletes private chat messages (supports soft delete logic).
 */
export const deletePrivateChat = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const friendId = BigInt(req.params.friendId as string);
    const { messageId } = req.params;

    if (messageId) {
        const msgId = BigInt(messageId as string);
        // Soft delete specific outgoing message
        await prisma.message.updateMany({
            where: { id: msgId, senderId: userId },
            data: { senderDeletedAt: new Date() }
        });
    } else {
        // Soft delete all messages in thread
        await prisma.message.updateMany({
            where: { senderId: userId, receiverId: friendId },
            data: { senderDeletedAt: new Date() }
        });
        await prisma.message.updateMany({
            where: { senderId: friendId, receiverId: userId },
            data: { receiverDeletedAt: new Date() }
        });

        // Permanently clear messages fully soft-deleted by both users
        await prisma.message.deleteMany({
            where: {
                OR: [
                    { senderId: userId, receiverId: friendId },
                    { senderId: friendId, receiverId: userId }
                ],
                NOT: { senderDeletedAt: null },
                receiverDeletedAt: { not: null }
            }
        });
    }

    sendSuccess(res, 200, "Message(s) deleted successfully");
});

/**
 * Marks messages from a friend as read.
 */
export const markMessagesAsRead = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const friendId = BigInt(req.params.friendId as string);

    await prisma.message.updateMany({
        where: {
            senderId: friendId,
            receiverId: userId,
            readAt: null
        },
        data: {
            readAt: new Date()
        }
    });

    sendSuccess(res, 200, "Messages marked as read successfully");
});

// ─── Group Chat Operations Controllers ─────────────────────────────────────────

/**
 * Lists group chats joined by the active user.
 */
export const listChatGroups = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);

    const userGroups = await prisma.chatGroupUser.findMany({
        where: { userId },
        include: {
            chatGroup: {
                include: {
                    users: {
                        select: { userId: true }
                    }
                }
            }
        }
    });

    const groups = userGroups.map((ug) => {
        const group = ug.chatGroup;
        return {
            id: group.id.toString(),
            name: group.name,
            image_url: group.imageUrl || "uploads/default_group.png",
            cloudinary_public_id: group.cloudinaryPublicId,
            created_by: group.createdBy?.toString(),
            users_count: group.users.length,
            created_at: group.createdAt
        };
    });

    res.status(200).json(groups);
});

/**
 * Creates a new chat group.
 */
export const createChatGroup = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const { name } = req.body;

    if (!name) {
        return next(new AppError("Group name is required", 400));
    }

    let imageUrl = "uploads/default_group.png";
    let cloudinaryPublicId = null;

    if (req.file) {
        imageUrl = req.file.path;
        cloudinaryPublicId = req.file.filename;
    }

    // Insert ChatGroup
    const group = await prisma.chatGroup.create({
        data: {
            name,
            imageUrl,
            cloudinaryPublicId,
            createdBy: userId
        }
    });

    // Attach Creator as member
    await prisma.chatGroupUser.create({
        data: {
            userId,
            chatGroupId: group.id
        }
    });

    const serializedGroup = {
        id: group.id.toString(),
        name: group.name,
        image_url: group.imageUrl,
        cloudinary_public_id: group.cloudinaryPublicId,
        created_by: group.createdBy?.toString(),
        users_count: 1,
        created_at: group.createdAt
    };

    // Join active Socket session to group room
    try {
        const io = getIO();
        const userRoom = `user:${userId.toString()}`;
        const activeSockets = await io.in(userRoom).fetchSockets();
        activeSockets.forEach((s) => {
            s.join(`group:${group.id.toString()}`);
            console.log(`[Socket.io] Creator dynamic join: Socket ${s.id} joined group:${group.id.toString()}`);
        });
        io.to(userRoom).emit("group-created", serializedGroup);
    } catch (err) {
        console.error("Socket emit error for group creation:", err);
    }

    sendSuccess(res, 201, "Group created successfully", serializedGroup);
});

/**
 * Joins or adds a user to a group chat.
 */
export const joinChatGroup = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const groupId = BigInt(req.params.groupId as string);
    const { username_or_email } = req.body;

    if (!username_or_email) {
        return next(new AppError("Username or email is required", 400));
    }

    const targetUser = await prisma.user.findFirst({
        where: {
            OR: [
                { username: username_or_email },
                { email: username_or_email }
            ]
        },
        select: { id: true, name: true, username: true, pictureUrl: true }
    });

    if (!targetUser) {
        return next(new AppError("User not found", 404));
    }

    // Check if user is already a group participant
    const existingParticipant = await prisma.chatGroupUser.findUnique({
        where: {
            userId_chatGroupId: {
                userId: targetUser.id,
                chatGroupId: groupId
            }
        }
    });

    const chatGroup = await prisma.chatGroup.findUnique({
        where: { id: groupId },
        include: {
            users: { select: { userId: true } }
        }
    });

    if (!chatGroup) {
        return next(new AppError("Group not found", 404));
    }

    if (!existingParticipant) {
        await prisma.chatGroupUser.create({
            data: {
                userId: targetUser.id,
                chatGroupId: groupId
            }
        });
    }

    const updatedGroup = {
        id: chatGroup.id.toString(),
        name: chatGroup.name,
        image_url: chatGroup.imageUrl || "uploads/default_group.png",
        created_by: chatGroup.createdBy?.toString(),
        users_count: chatGroup.users.length + (existingParticipant ? 0 : 1),
    };

    const serializedUser = serializeUser(targetUser);

    // Notify user via Socket.io
    try {
        const io = getIO();
        const targetUserRoom = `user:${targetUser.id.toString()}`;
        const targetSockets = await io.in(targetUserRoom).fetchSockets();
        targetSockets.forEach((s) => {
            s.join(`group:${groupId.toString()}`);
            console.log(`[Socket.io] Dynamic join: Socket ${s.id} joined group:${groupId.toString()}`);
        });
        io.to(targetUserRoom).emit("join-chat-group", {
            chatGroup: updatedGroup,
            user: serializedUser
        });
        io.to(`group:${groupId.toString()}`).emit("user-has-join-group", {
            chatGroup: updatedGroup,
            user: serializedUser
        });
    } catch (err) {
        console.error("Socket error on join group:", err);
    }

    sendSuccess(res, 200, "User added successfully", {
        user_id: targetUser.id.toString(),
        group: updatedGroup
    });
});

/**
 * Exits or removes a user from a group chat.
 */
export const exitChatGroup = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const groupId = BigInt(req.params.groupId as string);
    const { user_id } = req.body;

    if (!user_id) {
        return next(new AppError("User ID is required", 400));
    }

    const targetUserId = BigInt(user_id as string);
    const chatGroup = await prisma.chatGroup.findUnique({
        where: { id: groupId },
        include: {
            users: { select: { userId: true } }
        }
    });

    if (!chatGroup) {
        return next(new AppError("Group chat not found", 404));
    }

    // Verify creator or self removing
    if (chatGroup.createdBy !== userId && targetUserId !== userId) {
        return next(new AppError("Unauthorized action", 403));
    }

    // Remove user
    await prisma.chatGroupUser.deleteMany({
        where: {
            userId: targetUserId,
            chatGroupId: groupId
        }
    });

    const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, username: true, pictureUrl: true }
    });

    const updatedGroup = {
        id: chatGroup.id.toString(),
        name: chatGroup.name,
        image_url: chatGroup.imageUrl || "uploads/default_group.png",
        created_by: chatGroup.createdBy?.toString(),
        users_count: Math.max(0, chatGroup.users.length - 1),
    };

    const serializedUser = serializeUser(targetUser);

    // Notify socket sessions
    try {
        const io = getIO();
        const userRoom = `user:${targetUserId.toString()}`;
        const activeSockets = await io.in(userRoom).fetchSockets();
        activeSockets.forEach((s) => {
            s.leave(`group:${groupId.toString()}`);
            console.log(`[Socket.io] Dynamic leave: Socket ${s.id} left group:${groupId.toString()}`);
        });
        io.to(userRoom).emit("exit-chat-group", {
            chatGroup: updatedGroup,
            user: serializedUser
        });
        io.to(`group:${groupId.toString()}`).emit("user-has-exit-group", {
            chatGroup: updatedGroup,
            user: serializedUser
        });
    } catch (err) {
        console.error("Socket exit emit error:", err);
    }

    sendSuccess(res, 200, "User removed from group successfully", {
        user_id: targetUserId.toString(),
        group: updatedGroup
    });
});

/**
 * Retrieves group message history and participants.
 */
export const getGroupMessages = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const groupId = BigInt(req.params.groupId as string);

    // Fetch group messages
    const messages = await prisma.message.findMany({
        where: { chatGroupId: groupId },
        include: {
            sender: {
                select: { id: true, name: true, username: true, pictureUrl: true }
            }
        },
        orderBy: {
            createdAt: 'asc'
        }
    });

    // Fetch participant details
    const groupUsers = await prisma.chatGroupUser.findMany({
        where: { chatGroupId: groupId },
        include: {
            user: {
                select: { id: true, name: true, username: true, pictureUrl: true }
            }
        }
    });

    const participants = groupUsers.map(gu => serializeUser(gu.user));

    // Group Messages YYYY-MM-DD
    const groupedMessages: Record<string, any[]> = {};
    messages.forEach((msg) => {
        const dateStr = (msg.createdAt ? new Date(msg.createdAt).toISOString().split('T')[0] : 'unknown') || 'unknown';
        let group = groupedMessages[dateStr];
        if (!group) {
            group = [];
            groupedMessages[dateStr] = group;
        }
        group.push(serializeMessage(msg));
    });

    sendSuccess(res, 200, "Group chat messages loaded", {
        messages: groupedMessages,
        users: participants
    });
});

/**
 * Sends a group chat message.
 */
export const sendGroupMessage = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const senderId = BigInt(user.id);
    const groupId = BigInt(req.params.groupId as string);
    const { msg_body } = req.body;

    if (!msg_body) {
        return next(new AppError("Message body is required", 400));
    }

    // Verify user is in group
    const isMember = await prisma.chatGroupUser.findFirst({
        where: { userId: senderId, chatGroupId: groupId }
    });

    if (!isMember) {
        return next(new AppError("User is unauthorized to send messages to this group", 403));
    }

    // Create Message
    const message = await prisma.message.create({
        data: {
            senderId,
            chatGroupId: groupId,
            msgBody: msg_body,
            readAt: new Date()
        },
        include: {
            sender: {
                select: { id: true, name: true, username: true, pictureUrl: true }
            }
        }
    });

    const serializedMsg = serializeMessage(message);

    // Real-time socket broadcast
    try {
        const io = getIO();
        io.to(`group:${groupId.toString()}`).emit("NewChatGroupMessageEvent", {
            message: {
                ...serializedMsg,
                chatGroup: groupId.toString() // match vue expected field
            }
        });
    } catch (err) {
        console.error("Group socket emit error:", err);
    }

    sendSuccess(res, 201, "Message sent to group successfully", { message: serializedMsg });
});

/**
 * Deletes group message(s).
 */
export const deleteGroupMessage = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const groupId = BigInt(req.params.groupId as string);
    const { messageId } = req.params;

    if (messageId) {
        const msgId = BigInt(messageId as string);
        await prisma.message.deleteMany({
            where: { id: msgId, senderId: userId, chatGroupId: groupId }
        });
    } else {
        await prisma.message.deleteMany({
            where: { senderId: userId, chatGroupId: groupId }
        });
    }

    sendSuccess(res, 200, "Message(s) deleted successfully");
});

/**
 * Deletes a chat group (Creator only).
 */
export const deleteChatGroup = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const groupId = BigInt(req.params.groupId as string);

    const chatGroup = await prisma.chatGroup.findUnique({
        where: { id: groupId }
    });

    if (!chatGroup) {
        return next(new AppError("Group not found", 404));
    }

    if (chatGroup.createdBy !== userId) {
        return next(new AppError("Unauthorized action", 403));
    }

    // Delete Cloudinary image if it was uploaded
    if (chatGroup.imageUrl && chatGroup.cloudinaryPublicId) {
        try {
            await deleteCloudinaryFileByUrl(chatGroup.imageUrl);
        } catch (err) {
            console.error("Cloudinary file deletion failed:", err);
        }
    }

    // Delete group
    await prisma.chatGroup.delete({
        where: { id: groupId }
    });

    // Notify members via socket
    try {
        const io = getIO();
        io.to(`group:${groupId.toString()}`).emit("deleted-chat-group", {
            id: groupId.toString(),
            name: chatGroup.name
        });
    } catch (err) {
        console.error("Socket group delete broadcast failed:", err);
    }

    sendSuccess(res, 200, "Group chat deleted successfully");
});

// ─── Friend Follow Management Controllers ──────────────────────────────────────

/**
 * Returns a list of other users the current user can follow.
 */
export const getUsersToFollow = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const userId = BigInt(user.id);
    const page = Number(req.query.page) || 1;
    const limit = 40;
    const offset = (page - 1) * limit;
    const searchTerm = req.query.q ? String(req.query.q).toLowerCase().trim() : "";

    // Query followed/following user IDs
    const following = await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true }
    });

    const followers = await prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true }
    });

    const activeFriendIds = Array.from(new Set([
        ...following.map(f => f.followingId),
        ...followers.map(f => f.followerId),
        userId
    ]));

    // Query candidates
    const searchFilter = searchTerm ? {
        OR: [
            { name: { contains: searchTerm } },
            { username: { contains: searchTerm } }
        ]
    } : {};

    const usersQuery = {
        where: {
            id: { notIn: activeFriendIds },
            role: 3, // customer role (ROLES.CUSTOMER === 3)
            ...searchFilter
        }
    };

    const [candidates, totalCount] = await Promise.all([
        prisma.user.findMany({
            ...usersQuery,
            select: { id: true, name: true, username: true, pictureUrl: true },
            skip: offset,
            take: limit
        }),
        prisma.user.count({ where: usersQuery.where })
    ]);

    const serializedCandidates = candidates.map(serializeUser);

    res.status(200).json({
        data: serializedCandidates,
        current_page: page,
        last_page: Math.ceil(totalCount / limit),
        total: totalCount
    });
});

/**
 * Toggles a user follow status.
 */
export const toggleFollowStatus = asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const authUserId = BigInt(user.id);
    const targetUserId = BigInt(req.params.friendId as string);

    const existingFollow = await prisma.follow.findFirst({
        where: {
            followerId: authUserId,
            followingId: targetUserId
        }
    });

    let type = "";
    const friendDetails = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, username: true, pictureUrl: true }
    });

    if (existingFollow) {
        type = "unfollow";
        await prisma.follow.delete({ where: { id: existingFollow.id } });

        // Dispatch unfollow events
        try {
            const io = getIO();
            io.to(`user:${targetUserId.toString()}`).emit("UserHasBeenUnfollowedEvent", {
                friend: serializeUser(user),
                user: serializeUser(friendDetails)
            });
            io.to(`user:${authUserId.toString()}`).emit("UserHasBeenUnfollowedEvent", {
                friend: serializeUser(friendDetails),
                user: serializeUser(user)
            });
        } catch (err) {
            console.error("Unfollow socket error:", err);
        }
    } else {
        type = "followed";
        await prisma.follow.create({
            data: {
                followerId: authUserId,
                followingId: targetUserId
            }
        });

        // Dispatch follow events
        try {
            const io = getIO();
            io.to(`user:${targetUserId.toString()}`).emit("UserHasNewFollowerEvent", {
                friend: serializeUser(user),
                user: serializeUser(friendDetails)
            });
            io.to(`user:${authUserId.toString()}`).emit("UserHasNewFollowerEvent", {
                friend: serializeUser(friendDetails),
                user: serializeUser(user)
            });
        } catch (err) {
            console.error("Follow socket error:", err);
        }
    }

    sendSuccess(res, 200, `you have ${type} user successfully`);
});
