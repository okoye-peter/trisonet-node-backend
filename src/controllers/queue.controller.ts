import { Request, Response, NextFunction } from 'express';
import { Queue } from 'bullmq';
import { referralQueue } from '../queue/referral.queue.js';
import { smsQueue } from '../queue/sms.queue.js';
import { asyncHandler } from '../middlewares/asyncHandler.js';
import { sendSuccess } from '../utils/responseWrapper.js';
import { AppError } from '../utils/AppError.js';

const QUEUES: Record<string, Queue> = {
    referralQueue,
    smsQueue,
};

const JOB_STATUSES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'] as const;
type JobStatus = typeof JOB_STATUSES[number];

export const getAllQueues = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const results = await Promise.all(
        Object.entries(QUEUES).map(async ([name, queue]) => {
            const counts = await queue.getJobCounts(...JOB_STATUSES);
            const isPaused = await queue.isPaused();
            return { name, isPaused, counts };
        })
    );

    sendSuccess(res, 200, 'Queues retrieved', results);
});

export const getQueueJobs = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { queueName } = req.params;
    const queue = QUEUES[queueName];

    if (!queue) {
        return next(new AppError(`Queue "${queueName}" not found`, 404));
    }

    const status = (req.query.status as JobStatus) || 'failed';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    if (!JOB_STATUSES.includes(status)) {
        return next(new AppError(`Invalid status. Valid options: ${JOB_STATUSES.join(', ')}`, 400));
    }

    const [jobs, counts] = await Promise.all([
        queue.getJobs([status], start, end),
        queue.getJobCounts(...JOB_STATUSES),
    ]);

    const serialized = jobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        opts: job.opts,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        timestamp: job.timestamp,
    }));

    sendSuccess(res, 200, `Jobs in ${queueName} [${status}]`, {
        queue: queueName,
        status,
        counts,
        pagination: { page, limit, total: counts[status] ?? 0 },
        jobs: serialized,
    });
});

export const retryJob = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { queueName, jobId } = req.params;
    const queue = QUEUES[queueName];

    if (!queue) {
        return next(new AppError(`Queue "${queueName}" not found`, 404));
    }

    const job = await queue.getJob(jobId);

    if (!job) {
        return next(new AppError(`Job "${jobId}" not found`, 404));
    }

    await job.retry();
    sendSuccess(res, 200, `Job ${jobId} queued for retry`, { jobId });
});

export const removeJob = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { queueName, jobId } = req.params;
    const queue = QUEUES[queueName];

    if (!queue) {
        return next(new AppError(`Queue "${queueName}" not found`, 404));
    }

    const job = await queue.getJob(jobId);

    if (!job) {
        return next(new AppError(`Job "${jobId}" not found`, 404));
    }

    await job.remove();
    sendSuccess(res, 200, `Job ${jobId} removed`, { jobId });
});
