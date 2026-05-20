import { asyncHandler } from "../middlewares/asyncHandler";
import { NextFunction, Request, Response } from "express";
import { sendSuccess } from "../utils/responseWrapper";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { cloudinary } from "../config/cloudinary";

// Laravel polymorphic type strings (no morphMap registered)
const TWEET_MORPH = 'App\\Models\\Tweet';
const RETWEET_MORPH = 'App\\Models\\Retweet';

function diffForHumans(date: Date | null): string {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

function toStr(val: bigint | null | undefined): string {
    return val ? val.toString() : '';
}

export const getPost = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = BigInt((req as any).user.id);
    const id = BigInt(req.params.id as string);
    const type = req.query.type as string;

    if (type !== 'tweet' && type !== 'retweet') {
        return next(new AppError('Invalid type. Must be tweet or retweet.', 422));
    }

    const morphType = type === 'tweet' ? TWEET_MORPH : RETWEET_MORPH;

    // Fetch the post
    let post: any = null;
    if (type === 'tweet') {
        const tweet = await prisma.tweet.findUnique({
            where: { id },
            select: {
                id: true, userId: true, status: true, img: true, createdAt: true,
                user: { select: { id: true, name: true, username: true, pictureUrl: true } },
            },
        });
        if (!tweet) return next(new AppError('Post not found.', 404));

        const [likes, comments, retweets, isLiked] = await Promise.all([
            prisma.like.count({ where: { likeableType: TWEET_MORPH, likeableId: id } }),
            prisma.comment.count({ where: { commentableType: TWEET_MORPH, commentableId: id } }),
            prisma.retweet.count({ where: { retweetableType: TWEET_MORPH, retweetableId: id } }),
            prisma.like.findFirst({ where: { likeableType: TWEET_MORPH, likeableId: id, userId } }),
        ]);

        post = {
            id: toStr(tweet.id), userId: toStr(tweet.userId),
            user: { id: toStr(tweet.user.id), name: tweet.user.name, username: tweet.user.username, pictureUrl: tweet.user.pictureUrl || '' },
            status: tweet.status || '', img: tweet.img || undefined,
            type: 'tweet', totalLikes: likes, totalComments: comments, totalRetweets: retweets,
            isLiked: !!isLiked, formattedDate: diffForHumans(tweet.createdAt), createdAt: tweet.createdAt?.toISOString() || '',
        };
    } else {
        const retweet = await prisma.retweet.findUnique({
            where: { id },
            select: {
                id: true, userId: true, retweetMsg: true, retweetImg: true,
                retweetableType: true, retweetableId: true, createdAt: true,
                user: { select: { id: true, name: true, username: true, pictureUrl: true } },
            },
        });
        if (!retweet) return next(new AppError('Post not found.', 404));

        let retweetable: any = undefined;
        if (retweet.retweetableType === TWEET_MORPH) {
            const orig = await prisma.tweet.findUnique({
                where: { id: retweet.retweetableId },
                select: { id: true, status: true, img: true, user: { select: { id: true, name: true, username: true, pictureUrl: true } } },
            });
            if (orig) retweetable = { id: toStr(orig.id), status: orig.status || undefined, img: orig.img || undefined, user: { id: toStr(orig.user.id), name: orig.user.name, username: orig.user.username, pictureUrl: orig.user.pictureUrl || '' } };
        }

        const [likes, comments, retweets, isLiked] = await Promise.all([
            prisma.like.count({ where: { likeableType: RETWEET_MORPH, likeableId: id } }),
            prisma.comment.count({ where: { commentableType: RETWEET_MORPH, commentableId: id } }),
            prisma.retweet.count({ where: { retweetableType: RETWEET_MORPH, retweetableId: id } }),
            prisma.like.findFirst({ where: { likeableType: RETWEET_MORPH, likeableId: id, userId } }),
        ]);

        post = {
            id: toStr(retweet.id), userId: toStr(retweet.userId),
            user: { id: toStr(retweet.user?.id), name: retweet.user?.name || '', username: retweet.user?.username || '', pictureUrl: retweet.user?.pictureUrl || '' },
            status: retweet.retweetMsg || '', img: retweet.retweetImg || undefined,
            type: 'retweet', retweetable, totalLikes: likes, totalComments: comments, totalRetweets: retweets,
            isLiked: !!isLiked, formattedDate: diffForHumans(retweet.createdAt), createdAt: retweet.createdAt?.toISOString() || '',
        };
    }

    // Fetch comments with user info
    const rawComments = await prisma.comment.findMany({
        where: { commentableType: morphType, commentableId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
            id: true, comment: true, createdAt: true,
            user: { select: { id: true, name: true, username: true, pictureUrl: true } },
        },
    });

    const postComments = rawComments.map(c => ({
        id: toStr(c.id),
        comment: c.comment,
        formattedDate: diffForHumans(c.createdAt),
        user: { id: toStr(c.user.id), name: c.user.name, username: c.user.username, pictureUrl: c.user.pictureUrl || '' },
    }));

    return sendSuccess(res, 200, 'Post fetched successfully', { post, comments: postComments });
});

export const getPosts = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const userId = BigInt((req as any).user.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 10;

    // Fetch tweets with counts and isLiked
    const tweets = await prisma.tweet.findMany({
        select: {
            id: true,
            userId: true,
            status: true,
            img: true,
            createdAt: true,
            user: { select: { id: true, name: true, username: true, pictureUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Fetch retweets with their retweetable (the original post)
    const retweets = await prisma.retweet.findMany({
        select: {
            id: true,
            userId: true,
            retweetMsg: true,
            retweetImg: true,
            retweetableType: true,
            retweetableId: true,
            createdAt: true,
            user: { select: { id: true, name: true, username: true, pictureUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Collect all IDs needed for counts and isLiked
    const tweetIds = tweets.map(t => t.id);
    const retweetIds = retweets.map(r => r.id);

    // Batch fetch like counts
    const tweetLikeCounts = await prisma.like.groupBy({
        by: ['likeableId'],
        where: { likeableType: TWEET_MORPH, likeableId: { in: tweetIds } },
        _count: { id: true },
    });
    const retweetLikeCounts = await prisma.like.groupBy({
        by: ['likeableId'],
        where: { likeableType: RETWEET_MORPH, likeableId: { in: retweetIds } },
        _count: { id: true },
    });

    // Batch fetch comment counts
    const tweetCommentCounts = await prisma.comment.groupBy({
        by: ['commentableId'],
        where: { commentableType: TWEET_MORPH, commentableId: { in: tweetIds } },
        _count: { id: true },
    });
    const retweetCommentCounts = await prisma.comment.groupBy({
        by: ['commentableId'],
        where: { commentableType: RETWEET_MORPH, commentableId: { in: retweetIds } },
        _count: { id: true },
    });

    // Batch fetch retweet counts (how many times each has been retweeted)
    const tweetRetweetCounts = await prisma.retweet.groupBy({
        by: ['retweetableId'],
        where: { retweetableType: TWEET_MORPH, retweetableId: { in: tweetIds } },
        _count: { id: true },
    });
    const retweetRetweetCounts = await prisma.retweet.groupBy({
        by: ['retweetableId'],
        where: { retweetableType: RETWEET_MORPH, retweetableId: { in: retweetIds } },
        _count: { id: true },
    });

    // Batch fetch current user's likes
    const userTweetLikes = new Set(
        (await prisma.like.findMany({
            where: { likeableType: TWEET_MORPH, likeableId: { in: tweetIds }, userId },
            select: { likeableId: true },
        })).map(l => l.likeableId.toString())
    );
    const userRetweetLikes = new Set(
        (await prisma.like.findMany({
            where: { likeableType: RETWEET_MORPH, likeableId: { in: retweetIds }, userId },
            select: { likeableId: true },
        })).map(l => l.likeableId.toString())
    );

    // Collect retweetable original tweet/retweet IDs to resolve their data
    const retweetableOriginalTweetIds = retweets
        .filter(r => r.retweetableType === TWEET_MORPH)
        .map(r => r.retweetableId);
    const retweetableOriginalRetweetIds = retweets
        .filter(r => r.retweetableType === RETWEET_MORPH)
        .map(r => r.retweetableId);

    const originalTweetsMap = new Map(
        (await prisma.tweet.findMany({
            where: { id: { in: retweetableOriginalTweetIds } },
            select: { id: true, status: true, img: true, user: { select: { id: true, name: true, username: true, pictureUrl: true } } },
        })).map(t => [t.id.toString(), t])
    );
    const originalRetweetsMap = new Map(
        (await prisma.retweet.findMany({
            where: { id: { in: retweetableOriginalRetweetIds } },
            select: { id: true, retweetMsg: true, retweetImg: true, user: { select: { id: true, name: true, username: true, pictureUrl: true } } },
        })).map(r => [r.id.toString(), r])
    );

    // Helper lookup maps
    const tweetLikeMap = new Map(tweetLikeCounts.map(l => [l.likeableId.toString(), l._count.id]));
    const retweetLikeMap = new Map(retweetLikeCounts.map(l => [l.likeableId.toString(), l._count.id]));
    const tweetCommentMap = new Map(tweetCommentCounts.map(c => [c.commentableId.toString(), c._count.id]));
    const retweetCommentMap = new Map(retweetCommentCounts.map(c => [c.commentableId.toString(), c._count.id]));
    const tweetRetweetMap = new Map(tweetRetweetCounts.map(r => [r.retweetableId.toString(), r._count.id]));
    const retweetRetweetMap = new Map(retweetRetweetCounts.map(r => [r.retweetableId.toString(), r._count.id]));

    // Shape tweets
    const shapedTweets = tweets.map(t => ({
        id: toStr(t.id),
        userId: toStr(t.userId),
        user: {
            id: toStr(t.user.id),
            name: t.user.name,
            username: t.user.username,
            pictureUrl: t.user.pictureUrl || '',
        },
        status: t.status || '',
        img: t.img || undefined,
        type: 'tweet' as const,
        totalLikes: tweetLikeMap.get(t.id.toString()) || 0,
        totalComments: tweetCommentMap.get(t.id.toString()) || 0,
        totalRetweets: tweetRetweetMap.get(t.id.toString()) || 0,
        isLiked: userTweetLikes.has(t.id.toString()),
        formattedDate: diffForHumans(t.createdAt),
        createdAt: t.createdAt?.toISOString() || '',
    }));

    // Shape retweets
    const shapedRetweets = retweets.map(r => {
        const idStr = r.retweetableId.toString();
        let retweetable: any = undefined;
        if (r.retweetableType === TWEET_MORPH) {
            const orig = originalTweetsMap.get(idStr);
            if (orig) {
                retweetable = {
                    id: toStr(orig.id),
                    status: orig.status || undefined,
                    img: orig.img || undefined,
                    user: {
                        id: toStr(orig.user.id),
                        name: orig.user.name,
                        username: orig.user.username,
                        pictureUrl: orig.user.pictureUrl || '',
                    },
                };
            }
        } else if (r.retweetableType === RETWEET_MORPH) {
            const orig = originalRetweetsMap.get(idStr);
            if (orig) {
                retweetable = {
                    id: toStr(orig.id),
                    retweetMsg: orig.retweetMsg || undefined,
                    img: orig.retweetImg || undefined,
                    user: {
                        id: toStr(orig.user?.id),
                        name: orig.user?.name || '',
                        username: orig.user?.username || '',
                        pictureUrl: orig.user?.pictureUrl || '',
                    },
                };
            }
        }

        return {
            id: toStr(r.id),
            userId: toStr(r.userId),
            user: {
                id: toStr(r.user?.id),
                name: r.user?.name || '',
                username: r.user?.username || '',
                pictureUrl: r.user?.pictureUrl || '',
            },
            status: r.retweetMsg || '',
            img: r.retweetImg || undefined,
            type: 'retweet' as const,
            retweetable,
            totalLikes: retweetLikeMap.get(r.id.toString()) || 0,
            totalComments: retweetCommentMap.get(r.id.toString()) || 0,
            totalRetweets: retweetRetweetMap.get(r.id.toString()) || 0,
            isLiked: userRetweetLikes.has(r.id.toString()),
            formattedDate: diffForHumans(r.createdAt),
            createdAt: r.createdAt?.toISOString() || '',
        };
    });

    // Merge and sort by date, then paginate
    const all = [...shapedTweets, ...shapedRetweets].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = all.length;
    const last_page = Math.max(1, Math.ceil(total / limit));
    const paginated = all.slice((page - 1) * limit, page * limit);

    return sendSuccess(res, 200, 'Posts fetched successfully', {
        data: paginated,
        current_page: page,
        last_page,
        total,
        per_page: limit,
    });
});

function uploadBufferToCloudinary(buffer: Buffer, folder: string): Promise<{ url: string; publicId: string }> {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            { folder, resource_type: 'image' },
            (error, result) => {
                if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
                resolve({ url: result.secure_url, publicId: result.public_id });
            }
        ).end(buffer);
    });
}

export const createPost = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = BigInt((req as any).user.id);
    const { status } = req.body;
    const file = (req as any).file;

    if (!status && !file) {
        return next(new AppError('Either a status or an image is required.', 422));
    }

    let img: string | undefined;
    let cloudinaryPublicId = '';

    if (file) {
        const uploaded = await uploadBufferToCloudinary(file.buffer, 'feed_images');
        img = uploaded.url;
        cloudinaryPublicId = uploaded.publicId;
    }

    const tweet = await prisma.tweet.create({
        data: {
            userId,
            status: status || null,
            img: img || null,
            cloudinaryPublicId,
        },
        select: {
            id: true,
            userId: true,
            status: true,
            img: true,
            createdAt: true,
            user: { select: { id: true, name: true, username: true, pictureUrl: true } },
        },
    });

    return sendSuccess(res, 201, 'Post created successfully', {
        id: toStr(tweet.id),
        userId: toStr(tweet.userId),
        user: {
            id: toStr(tweet.user.id),
            name: tweet.user.name,
            username: tweet.user.username,
            pictureUrl: tweet.user.pictureUrl || '',
        },
        status: tweet.status || '',
        img: tweet.img || undefined,
        type: 'tweet',
        totalLikes: 0,
        totalComments: 0,
        totalRetweets: 0,
        isLiked: false,
        formattedDate: 'just now',
        createdAt: tweet.createdAt?.toISOString() || '',
    });
});

export const toggleLike = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = BigInt((req as any).user.id);
    const id = BigInt(req.params.id as string);
    const type = req.query.type as string;

    if (type !== 'tweet' && type !== 'retweet') {
        return next(new AppError('Invalid type. Must be tweet or retweet.', 422));
    }

    const likeableType = type === 'tweet' ? TWEET_MORPH : RETWEET_MORPH;

    const existing = await prisma.like.findFirst({
        where: { userId, likeableType, likeableId: id },
    });

    if (existing) {
        await prisma.like.delete({ where: { id: existing.id } });
        return sendSuccess(res, 200, 'Post unliked successfully', null);
    }

    await prisma.like.create({
        data: { userId, likeableType, likeableId: id },
    });

    return sendSuccess(res, 200, 'Post liked successfully', null);
});

export const addComment = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = BigInt((req as any).user.id);
    const id = BigInt(req.params.id as string);
    const { comment, tweet_type } = req.body;

    if (!comment || !comment.trim()) {
        return next(new AppError('Comment cannot be empty.', 422));
    }
    if (tweet_type !== 'tweet' && tweet_type !== 'retweet') {
        return next(new AppError('Invalid tweet_type.', 422));
    }

    const commentableType = tweet_type === 'tweet' ? TWEET_MORPH : RETWEET_MORPH;

    await prisma.comment.create({
        data: { userId, commentableType, commentableId: id, comment: comment.trim() },
    });

    return sendSuccess(res, 201, 'Comment added successfully', null);
});

export const retweetPost = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = BigInt((req as any).user.id);
    const id = BigInt(req.params.id as string);
    const { retweet_msg, tweet_type } = req.body;

    if (tweet_type !== 'tweet' && tweet_type !== 'retweet') {
        return next(new AppError('Invalid tweet_type.', 422));
    }

    const retweetableType = tweet_type === 'tweet' ? TWEET_MORPH : RETWEET_MORPH;

    await prisma.retweet.create({
        data: {
            userId,
            retweetableType,
            retweetableId: id,
            retweetMsg: retweet_msg || null,
            cloudinaryPublicId: '',
        },
    });

    return sendSuccess(res, 201, 'Post retweeted successfully', null);
});
