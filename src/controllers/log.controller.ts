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
        return sendSuccess(res, 200, 'Log directory not found', { logs: [], availableFiles: [] });
    }

    const files = fs.readdirSync(logDir);
    const logFiles = files.filter((f: string) => f.startsWith(prefix) && f.endsWith('.log')).sort().reverse();

    if (logFiles.length === 0) {
        return sendSuccess(res, 200, 'No log files found', { logs: [], availableFiles: [] });
    }

    // Pick the most recent log file
    const latestLog = logFiles[0] as string;
    const logContent = fs.readFileSync(path.join(logDir, latestLog), 'utf-8');
    const lines = logContent.split('\n').filter((line: string) => line.trim() !== '');

    // If the latest log is empty, try to find the last non-empty one
    let currentLog = latestLog;
    let currentLines = lines;

    if (currentLines.length === 0 && logFiles.length > 1) {
        for (let i = 1; i < logFiles.length; i++) {
            const content = fs.readFileSync(path.join(logDir, logFiles[i] as string), 'utf-8');
            const l = content.split('\n').filter((line: string) => line.trim() !== '');
            if (l.length > 0) {
                currentLog = logFiles[i] as string;
                currentLines = l;
                break;
            }
        }
    }

    sendSuccess(res, 200, 'Logs retrieved successfully', {
        filename: currentLog,
        latestFilename: latestLog,
        availableFiles: logFiles,
        content: currentLines
    });
};

export const getLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    readLogs(res, 'application-');
});

export const getPagaLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    readLogs(res, 'paga-');
});

export const getKycLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    readLogs(res, 'kyc-');
});

export const clearLogs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!fs.existsSync(logDir)) {
        return sendSuccess(res, 200, 'No logs to clear', null);
    }

    const files = fs.readdirSync(logDir);
    files.forEach((file: string) => {
        fs.unlinkSync(path.join(logDir, file));
    });

    sendSuccess(res, 200, 'All logs cleared successfully', null);
});
