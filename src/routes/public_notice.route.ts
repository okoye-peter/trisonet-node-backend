import { Router } from 'express';
import { protect } from '../middlewares/auth';
import { getActiveNotice } from '../controllers/public_notice.controller';

const router = Router();

router.use(protect);
router.get('/', getActiveNotice);

export default router;
