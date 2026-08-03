import { Router } from 'express';
import { protect, restrictTo } from '../middlewares/auth.js';
import { ROLES } from '../config/constants.js';
import { getCommissionLogs, getMyCommissionLogs } from '../controllers/commission_log.controller.js';

const router = Router();

router.use(protect);

router.get('/me', getMyCommissionLogs);
router.get('/', restrictTo(ROLES.SUPER_ADMIN, ROLES.ADMIN), getCommissionLogs);

export default router;
