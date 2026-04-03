import { User } from '../config/prisma.js';

declare global {
    namespace Express {
        interface Request {
            user: User;
        }
    }
}
