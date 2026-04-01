import { NextFunction, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import axios from "axios";
import { AppError } from "../utils/AppError";
import { PREMBLY } from "../config/constants";
import { kycLogger } from "../utils/logger";
import { prisma } from "../config/prisma";

export const uploadKyc = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { bvn } = req.body;
    const username = req.user?.username || 'Unknown User';

    // Multer upload.fields puts files in req.files
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!files?.image?.[0]) {
        return next(new AppError('Please provide both identification images.', 400));
    }

    const image_one_url = (files.image[0] as any).path;


    const options = {
        method: 'POST',
        url: 'https://api.prembly.com/verification/bvn_w_face',
        headers: {
            accept: 'application/json',
            'x-api-key': PREMBLY.API_KEY,
            'content-type': 'application/json'
        },
        data: { number: bvn, image: image_one_url }
    };


    try {
        const response = await axios.request(options);
        kycLogger.info('Prembly Verification Result', { username, bvn, response: response.data });

        // Store the verification result in DB
        await prisma.user.update({
            where: { id: req.user.id },
            data: { has_verified_level_2: true }
        });

        kycLogger.info('KYC Level 2 Status Updated', { username, bvn, status: 'Verified' });

        sendSuccess(res, 200, "Identity verification successful.", {
            premblyResponse: response.data,
            bvn
        });
    } catch (error: any) {
        kycLogger.error('Prembly API Error', { 
            username,
            bvn, 
            error: error.response?.data || error.message,
            stack: error.stack
        });
        return next(new AppError('Identity verification failed. Please ensure images are clear and retry.', 400));
    }
});