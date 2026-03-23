import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
// Use a 32-byte key - in production, this should be in process.env.CRYPTO_SECRET
const ENCRYPTION_KEY = Buffer.from((process.env.CRYPTO_SECRET || 'trisonet_paga_obfuscation_key_32').padEnd(32, '0')).slice(0, 32);
const IV_LENGTH = 16;

/**
 * Encrypts text using AES-256-CBC
 * Returns a string in the format "iv:encryptedText"
 */
export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}
