import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { validate } from '../middlewares/validateRequest';
import { registerSchema, loginSchema, refreshTokenSchema, registerPatronSchema } from '../validations/auth.validation';

import { authLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.post('/handoff', authController.handleAuthHandoff);
router.get('/patron-plans', authController.getPublicPatronPlans);
router.post('/register', validate(registerSchema), authController.register);
router.post('/register/patron', validate(registerPatronSchema), authController.registerPatron);
//  authLimiter,
router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh-token', validate(refreshTokenSchema), authController.getNewToken);

export const authRouter = router;
