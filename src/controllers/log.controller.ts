import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { asyncHandler } from '../middlewares/asyncHandler';
import { sendSuccess } from '../utils/responseWrapper';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.join(__dirname, '../../logs');

const readLogs = (res: Response, prefix: string) => {
    if (!fs.existsSync(logDir)) {
        return sendSuccess(res, 200, 'Logs retrieved successfully', { logs: [] });
    }

    const files = fs.readdirSync(logDir);
    const logFiles = files.filter(f => f.startsWith(prefix) && f.endsWith('.log'));

    if (logFiles.length === 0) {
        return sendSuccess(res, 200, 'Logs retrieved successfully', { logs: [] });
    }

    // Pick the most recent log file
    const latestLog = logFiles.sort().reverse()[0] as string;
    const logContent = fs.readFileSync(path.join(logDir, latestLog), 'utf-8');

    sendSuccess(res, 200, 'Logs retrieved successfully', {
        filename: latestLog,
        content: logContent.split('\n').filter(line => line.trim() !== '')
    });
};

export const getLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    readLogs(res, 'application-');
});

export const getPagaLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    readLogs(res, 'paga-');
});

export const clearLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!fs.existsSync(logDir)) {
        return sendSuccess(res, 200, 'No logs to clear', null);
    }

    const files = fs.readdirSync(logDir);
    files.forEach(file => {
        fs.unlinkSync(path.join(logDir, file));
    });

    sendSuccess(res, 200, 'All logs cleared successfully', null);
});
