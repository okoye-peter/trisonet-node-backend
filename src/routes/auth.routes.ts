import { Router } from 'express';
import { register, login, getNewToken } from '../controllers/auth.controller';
import { validate } from '../middlewares/validateRequest';
import { registerSchema, loginSchema, refreshTokenSchema } from '../validations/auth.validation';

const router = Router();

router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/refresh-token', validate(refreshTokenSchema), getNewToken);

export const authRouter = router;
