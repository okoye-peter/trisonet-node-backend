import { NextFunction, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { sendSuccess } from "../utils/responseWrapper";
import axios from "axios";
import { AppError } from "../utils/AppError";
import { PREMBLY } from "../config/constants";

export const uploadKyc = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const { bvn } = req.body;

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
        console.log('Prembly Verification Result:', response.data);

        // Store the verification result in DB if needed (TODO)

        sendSuccess(res, 200, "Identity verification successful.", {
            premblyResponse: response.data,
            bvn
        });
    } catch (error: any) {
        console.error('Prembly API Error:', error.response?.data || error.message);
        return next(new AppError('Identity verification failed. Please ensure images are clear and retry.', 400));
    }
});