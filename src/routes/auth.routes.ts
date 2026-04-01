import { Router } from 'express';
import { register, login, getNewToken, handleAuthHandoff } from '../controllers/auth.controller';
import { validate } from '../middlewares/validateRequest';
import { registerSchema, loginSchema, refreshTokenSchema } from '../validations/auth.validation';

import { authLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.post('/handoff', handleAuthHandoff);
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/login', authLimiter, validate(loginSchema), login);
router.post('/refresh-token', validate(refreshTokenSchema), getNewToken);

export const authRouter = router;
