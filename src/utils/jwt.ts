import jwt from 'jsonwebtoken';

export const signAccessToken = (id: string) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'secret', {
        expiresIn: '24h',
    });
};

export const signRefreshToken = (id: string) => {
    return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET || 'refresh_secret', {
        expiresIn: '7d',
    });
};
