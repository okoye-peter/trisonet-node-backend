import { Router } from 'express';
import { protect, restrictTo } from '../middlewares/auth.js';
import { ROLES } from '../config/constants.js';
import { getAllQueues, getQueueJobs, retryJob, removeJob } from '../controllers/queue.controller.js';

const router = Router();

router.use(protect, restrictTo(ROLES.SUPER_ADMIN, ROLES.ADMIN));

router.get('/', getAllQueues);
router.get('/:queueName/jobs', getQueueJobs);
router.post('/:queueName/jobs/:jobId/retry', retryJob);
router.delete('/:queueName/jobs/:jobId', removeJob);

export default router;
