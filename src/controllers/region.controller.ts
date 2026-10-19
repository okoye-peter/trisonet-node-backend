import { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { prisma } from "../config/prisma";
import { sendSuccess } from '../utils/responseWrapper';
import { continents, countries, languages } from 'countries-list'
import { AppError } from "../utils/AppError";
import StateMigrationService from "../services/state_migration.service";


export const getRegions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const regions = await prisma.region.findMany()
    sendSuccess(res, 201, 'Regions fetched successfully', regions)
})

export const getStates = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const country = typeof req.query.country === 'string' ? req.query.country.trim() : '';
    if (!country) return next(new AppError('country is required', 400));

    const states = await StateMigrationService.getStatesByCountry(country);
    sendSuccess(res, 200, 'States fetched successfully', states);
})

export const getCountries = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // countries table (seeded by the PHP CountrySeeder from this same package); the package
    // list is only a fallback until that seeder has run.
    const seeded = await prisma.country.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    const countryNames = seeded.length
        ? seeded.map(country => country.name)
        : Object.values(countries).map(country => country.name).sort((a, b) => a.localeCompare(b));
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