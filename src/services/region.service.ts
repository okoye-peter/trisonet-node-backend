import { prisma } from "../config/prisma";

export default class RegionService {
    static async isRegionLimitReached(regionId: bigint, role: number): Promise<boolean> {
        const region = await prisma.region.findUnique({ where: { id: regionId } });
        if (!region) {
            throw new Error('Region not found');
        }
        const count = await prisma.user.count({ where: { regionId, role } });
        return count >= region.max;
    }
}