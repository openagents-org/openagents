/**
 * Encryption for credentials at rest.
 *
 * The gateway holds every platform credential and every binding key, and it is
 * the internet-facing half of the system — so a database dump must not be
 * enough to post as someone's bot. AES-256-GCM, key from the environment.
 *
 * The tag is stored with the ciphertext, so a tampered row fails to decrypt
 * rather than decrypting to something plausible.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { config } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function key(): Buffer {
  const raw = Buffer.from(config.encryptionKey, 'base64');
  if (raw.length !== 32) {
    throw new Error(
      'GATEWAY_ENCRYPTION_KEY must be 32 bytes, base64-encoded. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return raw;
}

/** Encrypt a JSON-serialisable value. Returns `iv.tag.ciphertext`, base64. */
export function seal(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/** Reverse of `seal`. Throws if the value was tampered with or truncated. */
export function open<T = unknown>(sealed: string): T {
  const parts = sealed.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed sealed value');
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf-8')) as T;
}

/**
 * A fresh binding credential.
 *
 * Generated here, kept here. The backend is given only the SHA-256, which is
 * why re-sending an activation is harmless — same binding, same fingerprint,
 * same row — and why there is nothing on their side to recover or leak.
 */
export function newIntegrationKey(): string {
  return randomBytes(32).toString('base64url');
}
