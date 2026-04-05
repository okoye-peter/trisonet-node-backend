import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import axios from "axios";
import { AppError } from "../utils/AppError";
import { PREMBLY } from "../config/constants";
import { kycLogger } from "../utils/logger";
import { prisma } from "../config/prisma";
import { deleteCloudinaryFileByUrl } from "../utils/cloudinaryHelper";
import { encryptText } from "../utils/crypto";

/**
 * Helper to clean up Cloudinary assets and log errors if any
 */
const cleanupCloudinary = (url: string) => {
    if (!url) return;
    deleteCloudinaryFileByUrl(url).catch(e => 
        kycLogger.error('Cloudinary Cleanup Error', { url, error: e.message })
    );
};

/**
 * Robust name matching check
 */
const verifyNameMatch = (fullName: string, firstName: string, lastName: string): boolean => {
    if (!fullName || !firstName || !lastName) return false;
    
    const normalizedFullName = fullName.toLowerCase();
    const nameParts = normalizedFullName.split(/\s+/).filter(Boolean);
    
    const normalizedFirst = firstName.toLowerCase().trim();
    const normalizedLast = lastName.toLowerCase().trim();

    // Check if both names returned by API are present in the user's registered name parts
    return nameParts.includes(normalizedFirst) && nameParts.includes(normalizedLast);
};

export const uploadKyc = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { bvn } = req.body;
    const user = req.user;
    const username = user?.username || 'Unknown User';

    // Basic BVN Validation
    if (!bvn || bvn.length !== 11 || !/^\d+$/.test(bvn)) {
        return next(new AppError('Please provide a valid 11-digit BVN.', 400));
    }

    // Multer upload.fields puts files in req.files
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (!files?.image?.[0]) {
        return next(new AppError('Please provide the identification image.', 400));
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

        // Check for unsuccessful status from Prembly
        if (!response.data.status) {
            cleanupCloudinary(image_one_url);
            return next(new AppError(response.data.message || 'Verification failed at provider.', 400));
        }

        const { firstName, lastName } = response.data.data;

        // Verify if names match the user's registered name
        if (verifyNameMatch(user?.name || '', firstName, lastName)) {
            await prisma.user.update({
                where: { id: user.id },
                data: { 
                    hasVerifiedLevel2: true,
                    bvn: encryptText(bvn)
                }
            });

            kycLogger.info('KYC Verification Successful', { userId: user.id, username, bvn });
            return sendSuccess(res, 200, "Identity verification successful.");
        } else {
            cleanupCloudinary(image_one_url);
            kycLogger.warn('KYC Name Mismatch', { 
                userId: user.id, 
                username, 
                registeredName: user?.name, 
                receivedNames: { firstName, lastName } 
            });
            return next(new AppError('Identity verification failed. Your name does not match the name on your BVN.', 400));
        }

    } catch (error: any) {
        // Cleanup Cloudinary image on any unexpected failure
        cleanupCloudinary(image_one_url);

        kycLogger.error('Prembly API Error', { 
            username,
            bvn, 
            error: error.response?.data || error.message,
            stack: error.stack
        });

        const errorMessage = error.response?.data?.message || 'Identity verification failed. Please ensure images are clear and retry.';
        return next(new AppError(errorMessage, 500));
    }
});