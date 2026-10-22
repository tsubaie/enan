import 'server-only';
import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '@/core/config/env';
import { withTransaction, type Database } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { initialized, recordLogin, userByEmail, userById } from '@/core/db/auth-repo';
import {
  codeRequests,
  insertCode,
  latestCode,
  missCode,
  retireCodes,
  spendCode,
} from '@/core/db/sign-in-code-repo';
import { AppError } from '@/core/http/errors';
import { throttle } from './login';
import { requireMethod } from './methods';
import { newSession } from './session';
import { User } from './validation';
export const codeMinutes = 10;
const maxAttempts = 5;
const sendsPerEmail = 3;
const sendsPerAddress = 10;
// The code is kept as an HMAC under a key derived from SESSION_SECRET and bound to its row, so a
// copy of the database does not let six digits be tried offline, and a hash cannot be moved to
// another request.
function codeKey() {
  return Buffer.from(hkdfSync('sha256', env().SESSION_SECRET, 'Enan', 'sign-in-code-v1', 32));
}
function codeHash(codeId: string, code: string) {
  return createHmac('sha256', codeKey()).update(`${codeId}:${code}`).digest('hex');
}
/**
 * ADMIN-B63: every request is answered the same way whether or not the email has an account: the
 * same throttle, the same row written, the same reply. Only an active account gets a code, which
 * the caller mails after the response. Asking again replaces the earlier code.
 */
export async function requestCode(handle: Database, email: string, ip: string | null) {
  return withTransaction(handle, async (database) => {
    if (!(await initialized(database))) throw new AppError('forbidden');
    await requireMethod(database, 'code');
    const sent = await codeRequests(database, email, ip);
    if (sent.byEmail >= sendsPerEmail || sent.byAddress >= sendsPerAddress)
      throw new AppError('rate_limited', { scope: 'sign_in_code', retryAfterSeconds: 900 });
    const user = await userByEmail(database, email);
    const usable = user && user.isActive && !user.deletedAt ? user : null;
    const codeId = id();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await retireCodes(database, email);
    await insertCode(database, {
      id: codeId,
      email,
      userId: usable?.id ?? null,
      codeHash: usable ? codeHash(codeId, code) : null,
      ip: ip ?? '',
      expiresAt: new Date(Date.now() + codeMinutes * 60000),
    });
    return usable ? { user: User.parse(usable), code } : null;
  });
}
function matches(expected: string | null, codeId: string, code: string) {
  if (!expected) return false;
  return timingSafeEqual(Buffer.from(codeHash(codeId, code)), Buffer.from(expected));
}
/**
 * ADMIN-B63: a code signs in once, within ten minutes, and survives five wrong guesses; every wrong
 * one also counts as a failed login, so the login throttle (ADMIN-B20) bounds guessing across
 * codes. The account must still be active when the code is used.
 */
export async function signInWithCode(
  handle: Database,
  input: { email: string; code: string },
  ip: string | null,
) {
  const result = await withTransaction(handle, async (database) => {
    if (!(await initialized(database))) throw new AppError('forbidden');
    await requireMethod(database, 'code');
    await throttle(database, input.email, ip);
    const row = await latestCode(database, input.email, maxAttempts);
    const matched = row ? matches(row.codeHash, row.id, input.code) : false;
    if (row) await (matched ? spendCode(database, row.id) : missCode(database, row.id));
    const user = matched && row?.userId ? await userById(database, row.userId) : undefined;
    const valid = Boolean(user && user.isActive && !user.deletedAt);
    await recordLogin(database, input.email, ip, valid);
    if (!user || !valid) return null;
    return { user: User.parse(user), token: await newSession(database, user.id) };
  });
  if (!result) throw new AppError('unauthenticated', null, true);
  return result;
}
