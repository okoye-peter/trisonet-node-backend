import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { AppError } from '../utils/AppError';
import { sendSuccess } from '../utils/responseWrapper';
import { deleteCloudinaryFileByUrl } from '../utils/cloudinaryHelper';

export const uploadFile = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.file) {
        return next(new AppError('No file uploaded', 400));
    }

    sendSuccess(res, 200, 'File uploaded successfully', {
        url: req.file.path,
        public_id: req.file.filename,
        size: req.file.size,
        format: req.file.mimetype,
    });
});

export const deleteFile = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { url } = req.body;

    const isDeleted = await deleteCloudinaryFileByUrl(url);

    if (!isDeleted) {
        return next(new AppError('Invalid Cloudinary URL or failed to delete file', 400));
    }

    sendSuccess(res, 200, 'File deleted successfully');
});
