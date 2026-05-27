import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

function getSecret(): Buffer {
  const secret = process.env.CRYPTO_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('[crypto] CRYPTO_SECRET env var must be at least 32 characters.');
  }
  // Use first 32 bytes of the secret as the key
  return Buffer.from(secret.slice(0, 32), 'utf8');
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing IV + auth tag + ciphertext.
 */
export function encryptApiKey(plaintext: string): string {
  const key = getSecret();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Layout: [IV (12 bytes)] [Auth Tag (16 bytes)] [Ciphertext (variable)]
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts a base64-encoded string produced by encryptApiKey.
 * Returns the original plaintext string.
 */
export function decryptApiKey(encoded: string): string {
  const key = getSecret();
  const combined = Buffer.from(encoded, 'base64');

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
