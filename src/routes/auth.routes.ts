import { Router } from 'express';
import { register, login, getNewToken, handleAuthHandoff, registerPatron, getPublicPatronPlans } from '../controllers/auth.controller';
import { validate } from '../middlewares/validateRequest';
import { registerSchema, loginSchema, refreshTokenSchema, registerPatronSchema } from '../validations/auth.validation';

import { authLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.post('/handoff', handleAuthHandoff);
router.get('/patron-plans', getPublicPatronPlans);
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/register/patron', authLimiter, validate(registerPatronSchema), registerPatron);
//  authLimiter,
router.post('/login', validate(loginSchema), login);
router.post('/refresh-token', validate(refreshTokenSchema), getNewToken);

export const authRouter = router;
