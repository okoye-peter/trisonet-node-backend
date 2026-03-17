import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { prisma } from "../config/prisma";
import { sendSuccess } from '../utils/responseWrapper';
import { continents, countries, languages } from 'countries-list'


export const getRegions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const regions = await prisma.region.findMany()
    sendSuccess(res, 201, 'Regions fetched successfully', regions)
})

export const getCountries = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const countryNames = Object.values(countries).map(country => country.name).sort((a, b) => a.localeCompare(b));
    sendSuccess(res, 200, 'Countries fetched successfully', countryNames);
})

export const getTop5Users = asyncHandler(async (req: any, res: Response, next: NextFunction) => {
    const user = req.user;

    const top5 = await prisma.user.findMany({
        where: {
            regionId: user.regionId,
            status: true,
        },
        include: {
            _count: {
                select: {
                    referrals: {
                        where: { status: true }
                    }
                }
            }
        },
        orderBy: [
            {
                referrals: {
                    _count: 'desc'
                }
            },
            {
                referralActivateAt: 'asc'
            }
        ],
        take: 5
    });

    sendSuccess(res, 200, 'Top 5 users fetched successfully', top5);
})