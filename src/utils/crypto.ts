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



export function encryptText(plainText: string): string {
  const iv = crypto.randomBytes(16); // random IV each time
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Store iv:encryptedData so we can decrypt later
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptEncryptedText(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(':');
  
  if (!ivHex || !encrypted) {
    throw new Error('Invalid encrypted text format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Creates a deterministic SHA-256 hash of a string
 */
export function hashString(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

