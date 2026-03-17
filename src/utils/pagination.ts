export interface PaginateOptions {
    page?: number | string;
    limit?: number | string;
}

export interface PaginatedResult<T> {
    data: T[];
    meta: {
        totalItems: number;
        itemsPerPage: number;
        currentPage: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}

export const paginate = async <T, A>(
    model: { findMany: (args: any) => Promise<T[]>, count: (args?: any) => Promise<number> },
    args: A = {} as A,
    options: PaginateOptions = {}
): Promise<PaginatedResult<T>> => {
    const page = Math.max(Number(options.page) || 1, 1);
    const limit = Math.max(Number(options.limit) || 10, 1);
    const skip = (page - 1) * limit;

    const [data, totalItems] = await Promise.all([
        model.findMany({
            ...args,
            skip,
            take: limit,
        }),
        model.count({
            where: (args as any).where,
        }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
        data,
        meta: {
            totalItems,
            itemsPerPage: limit,
            currentPage: page,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
        },
    };
};
