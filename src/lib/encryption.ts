import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Get the encryption key as a buffer (must be 32 bytes for AES-256)
function getKey(): Buffer {
  const key = env.encryptionKey;
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters');
  }
  return Buffer.from(key, 'utf8');
}

// Encrypt a string value
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

// Decrypt an encrypted string
export function decrypt(encryptedValue: string): string {
  const key = getKey();
  const parts = encryptedValue.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }

  const ivHex = parts[0]!;
  const authTagHex = parts[1]!;
  const ciphertext = parts[2]!;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Encrypt OAuth tokens object
export function encryptTokens(tokens: {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}): {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
} {
  return {
    access_token: encrypt(tokens.access_token),
    refresh_token: encrypt(tokens.refresh_token),
    expiry_date: tokens.expiry_date,
  };
}

// Decrypt OAuth tokens object
export function decryptTokens(encryptedTokens: {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}): {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
} {
  return {
    access_token: decrypt(encryptedTokens.access_token),
    refresh_token: decrypt(encryptedTokens.refresh_token),
    expiry_date: encryptedTokens.expiry_date,
  };
}
