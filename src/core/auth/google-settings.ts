import 'server-only';
import { env } from '@/core/config/env';
import { GoogleSettingsWrite, GoogleStatus } from '@/core/config/google-schema';
import { type Database } from '@/core/db/client';
import {
  deleteGoogleSettings,
  readGoogleSettings,
  saveGoogleSettings,
} from '@/core/db/google-settings-repo';
import { writeAudit } from '@/core/db/audit-repo';
import { AppError } from '@/core/http/errors';
import { seal, unseal } from './sealed';
// ADMIN-B65 (ADR 0053): the OAuth client saved from Administration wins over GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET, which apply while nothing is saved. The secret is sealed to its client id.
const purpose = 'google-credentials-v1';
export function googleRedirectUri() {
  return new URL('/api/v1/auth/google/callback', env().APP_URL).href;
}
export async function googleStatus(database: Database) {
  const saved = await readGoogleSettings(database);
  const config = env();
  const fromEnv = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
  return GoogleStatus.parse({
    source: saved ? 'saved' : fromEnv ? 'environment' : 'none',
    clientId: saved?.clientId ?? (fromEnv ? config.GOOGLE_CLIENT_ID : null),
    hasSecret: Boolean(saved) || fromEnv,
    redirectUri: googleRedirectUri(),
  });
}
// The client to sign in with, or null when none is configured. A saved secret that no longer
// opens (SESSION_SECRET changed) fails closed.
export async function googleClient(database: Database) {
  const saved = await readGoogleSettings(database);
  if (saved) {
    const secret = unseal(saved.encryptedSecret, purpose, saved.clientId);
    if (secret === null) throw new AppError('forbidden', { reason: 'google_credentials' });
    return { clientId: saved.clientId, clientSecret: secret };
  }
  const config = env();
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) return null;
  return { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET };
}
export async function saveGoogle(database: Database, actor: string, input: unknown) {
  const value = GoogleSettingsWrite.parse(input);
  const previous = await readGoogleSettings(database);
  // A blank secret keeps the saved one, but only for the same client: a new client needs its own.
  const kept =
    previous && !value.clientSecret && previous.clientId === value.clientId
      ? unseal(previous.encryptedSecret, purpose, previous.clientId)
      : null;
  const secret = value.clientSecret || kept;
  if (!secret)
    throw new AppError('validation_failed', { fieldErrors: { clientSecret: ['required'] } });
  await saveGoogleSettings(database, {
    clientId: value.clientId,
    encryptedSecret: seal(secret, purpose, value.clientId),
  });
  await writeAudit(database, actor, 'google.settings.save', 'google_settings', null, {
    clientId: value.clientId,
  });
  return googleStatus(database);
}
export async function removeGoogle(database: Database, actor: string) {
  await deleteGoogleSettings(database);
  await writeAudit(database, actor, 'google.settings.remove', 'google_settings', null, {});
  return googleStatus(database);
}
