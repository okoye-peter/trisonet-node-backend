import { Router } from "express";
import { protect } from "../middlewares/auth";
import { getNotifications, getNotification, markRead, markAllRead } from "../controllers/notification.controller";

const router = Router();

router.use(protect);

router.get('/', getNotifications);
router.get('/:id', getNotification);
router.patch('/:id/read', markRead);
router.patch('/read-all', markAllRead);

export default router;
