import { prisma } from "../config/prisma";

export const listCategories = async () => {
    const categories = await prisma.category.findMany({
        orderBy: { displayName: 'asc' },
    });

    return categories.map((c) => ({
        id: c.id.toString(),
        name: c.name,
        displayName: c.displayName,
    }));
};
