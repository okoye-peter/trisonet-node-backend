import { Router } from "express";
import { protect } from "../middlewares/auth";
import { upload } from "../config/cloudinary";
import {
    getUserFriends,
    getChatWithFriend,
    sendPrivateMessage,
    deletePrivateChat,
    listChatGroups,
    createChatGroup,
    joinChatGroup,
    exitChatGroup,
    getGroupMessages,
    sendGroupMessage,
    deleteGroupMessage,
    deleteChatGroup,
    getUsersToFollow,
    toggleFollowStatus,
    markMessagesAsRead
} from "../controllers/talkzone.controller";

const router = Router();

router.use(protect);

// Private Direct Messages & Friends List
router.get("/friends", getUserFriends);
router.get("/friends/messages/:friendId", getChatWithFriend);
router.post("/friends/messages", sendPrivateMessage);
router.post("/chats/:friendId/delete", deletePrivateChat);
router.post("/chats/:friendId/delete/:messageId", deletePrivateChat);

// Group Chat Operations
router.get("/group_chats", listChatGroups);
router.post("/group_chats", upload.single("image_url"), createChatGroup);
router.post("/group_chats/:groupId/join", joinChatGroup);
router.post("/group_chats/:groupId/exit", exitChatGroup);
router.get("/group_chats/:groupId/messages", getGroupMessages);
router.post("/group_chats/:groupId/messages", sendGroupMessage);
router.post("/group_chats/:groupId/messages/delete", deleteGroupMessage);
router.post("/group_chats/:groupId/messages/delete/:messageId", deleteGroupMessage);
router.post("/group_chats/:groupId/delete", deleteChatGroup);

// Friend Management & Searching
router.get("/users/not_following", getUsersToFollow);
router.post("/users/:friendId/follow/toggle", toggleFollowStatus);
router.post("/users/:friendId/message/mark_as_read", markMessagesAsRead);

export default router;
