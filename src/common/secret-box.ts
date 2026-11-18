/**
 * Encrypts small secrets before they are stored in the database, e.g. a super admin's
 * two-step-login secret (ADR-0028). Someone who gets a copy of the database still can't create
 * login codes without SECRETS_KEY from the server's .env.
 *
 *   const stored = seal('JBSWY3DPEHPK3PXP');   // "v1.<iv>.<tag>.<data>", safe to save
 *   open(stored)                                // "JBSWY3DPEHPK3PXP"
 *
 * AES-256-GCM: the stored value can't be read or changed without the key.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key(): Buffer {
  const secret = process.env.SECRETS_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('SECRETS_KEY must be set in .env (at least 32 characters)');
  }
  return createHash('sha256').update(secret).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function open(stored: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
