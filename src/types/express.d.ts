import { User } from '../generated/prisma/index.js';

declare global {
    namespace Express {
        interface Request {
            user: User;
        }
    }
}
