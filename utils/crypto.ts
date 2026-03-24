import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MASTER_KEY_PATH = path.join(process.cwd(), 'router.master.key');
let cachedMasterKey: Buffer | null = null;

function parseEnvMasterKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) {
    throw new Error('ROUTER_MASTER_KEY must be 32 bytes in hex or base64 format');
  }
  return decoded;
}

function getMasterKey(): Buffer {
  if (cachedMasterKey) {
    return cachedMasterKey;
  }

  const envKey = process.env.ROUTER_MASTER_KEY;
  if (envKey) {
    cachedMasterKey = parseEnvMasterKey(envKey);
    return cachedMasterKey;
  }

  if (existsSync(MASTER_KEY_PATH)) {
    cachedMasterKey = Buffer.from(readFileSync(MASTER_KEY_PATH, 'utf8').trim(), 'base64');
    return cachedMasterKey;
  }

  cachedMasterKey = randomBytes(32);
  writeFileSync(MASTER_KEY_PATH, cachedMasterKey.toString('base64'), 'utf8');
  return cachedMasterKey;
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(size: number = 32): string {
  return randomBytes(size).toString('base64url');
}

export function generateApiKey(prefix: string = 'router'): string {
  return `${prefix}_${randomToken(24)}`;
}

export function maskSecret(value: string): string {
  if (value.length <= 10) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function encryptSecret(secret: string): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptSecret(payload: { ciphertext: string; iv: string; tag: string }): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getMasterKey(),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
