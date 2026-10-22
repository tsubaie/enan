import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '@/core/config/env';
// ADR 0053: a credential Enan keeps for another service (the AI key, the mail password) is sealed
// with AES-256-GCM. Each purpose derives its own key from SESSION_SECRET, and the row's identity is
// bound as associated data, so a sealed value opens only as the kind and row it was written for.
// The salt keeps the product's former name: saved keys were encrypted under it (ADR 0048).
function key(purpose: string) {
  return Buffer.from(hkdfSync('sha256', env().SESSION_SECRET, 'ExecutiveOS', purpose, 32));
}
export function seal(value: string, purpose: string, context: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(purpose), nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
// Null when the value was sealed under another SESSION_SECRET, purpose or context, or is damaged:
// the caller fails closed rather than using a credential it cannot vouch for.
export function unseal(value: string, purpose: string, context: string) {
  try {
    const [version, nonce, tag, encrypted] = value.split('.');
    if (version !== 'v1' || !nonce || !tag || !encrypted) return null;
    const cipher = createDecipheriv('aes-256-gcm', key(purpose), Buffer.from(nonce, 'base64'));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(encrypted, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
