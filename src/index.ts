import 'dotenv/config';

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { morganMiddleware } from './middlewares/morganMiddleware';
import { errorHandler } from './middlewares/errorHandler';

import { authRouter } from './routes/auth.routes';
import { uploadRouter } from './routes/upload.routes';
import { logRouter } from './routes/log.routes';
import regionRouter from './routes/region.route';
import passwordResetRouter from './routes/password_reset.routes';
import userRouter from './routes/user.route';
import vtuRouter from './routes/vtu.routes';
import bankRouter from './routes/bank.route';
import pimCardRouter from './routes/pim_card.route';

// Initialize background workers
import './queue';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security Middlewares ─────────────────────────────────────────────────────
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // Disable CSP in dev for easier testing
}));

app.use(cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const rawOrigins = process.env.ALLOWED_ORIGINS || '';
        const allowedLinks = rawOrigins
            .split(',')
            .map((link: string) => link.replace(/['"]/g, '').trim()) // Remove any extra quotes
            .filter(Boolean);

        console.log(`[CORS] Incoming origin: ${origin}`);
        console.log(`[CORS] Allowed origins:`, allowedLinks);

        if (!origin || allowedLinks.includes(origin) || allowedLinks.includes('*')) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocker origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morganMiddleware);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'success', message: 'Backend is running' });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/uploads', uploadRouter);
app.use('/api/logs', logRouter);
app.use('/api/regions', regionRouter);
app.use('/api/password_reset', passwordResetRouter);
app.use('/api/users', userRouter);
app.use('/api/banks', bankRouter);
app.use('/api/vtu', vtuRouter);
app.use('/api/pim_cards', pimCardRouter);

app.all('/{*splat}', (req: Request, res: Response, next: NextFunction) => {
    res.status(404).json({
        status: 'fail',
        message: `Can't find ${req.originalUrl} on this server!`,
        data: null,
    });
});

app.use(errorHandler);

import { referralWorker } from './queue/workers/referral.worker';
import { referralQueue } from './queue/referral.queue';
import { smsWorker } from './queue/workers/sms.worker';
import { smsQueue } from './queue/sms.queue';

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

let isShuttingDown = false;

// Graceful Shutdown
async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log("Shutting down gracefully...");
    try {
        await referralWorker.close(); // Finish active jobs, stop accepting new ones
        await referralQueue.close();  // Close the queue connection
        await smsWorker.close();
        await smsQueue.close();
        console.log("Closed background workers and queues.");
    } catch (err) {
        console.error("Error during graceful shutdown:", err);
    }

    server.close(() => {
        console.log("HTTP server closed.");
        process.exit(0);
    });

    // Fallback: forcefully exit if connections hang the server.close()
    setTimeout(() => {
        console.error("Could not close connections in time, forcefully shutting down");
        process.exit(1);
    }, 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);