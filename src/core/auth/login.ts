import 'server-only';
import { withTransaction, type Database } from '@/core/db/client';
import {
  loginFailures,
  recordLogin,
  userByEmail,
  lockWorkspace,
  usedRecovery,
  recoverUser,
} from '@/core/db/auth-repo';
import { AppError } from '@/core/http/errors';
import { verifyPassword, hashPassword, matchesToken, digest } from './password';
import { type Recovery } from './validation';
import type { z } from 'zod';
import { env } from '@/core/config/env';
const maxFailures = 5;
// ADMIN-B20: five failures against one email, or five from one client address, close that bucket
// for fifteen minutes. The two are counted apart because their union is a limit nobody configured:
// three failures on an account plus two from an unrelated address used to add up to a lockout.
export async function throttle(database: Database, email: string | null, ip: string | null) {
  const failures = await loginFailures(database, email, ip);
  if (failures.byEmail >= maxFailures || failures.byAddress >= maxFailures)
    throw new AppError('rate_limited', { scope: 'login', retryAfterSeconds: 900 });
}
// ADMIN-B20 for the current-password checks of the account (ACCT-B01, ACCT-B02): the same email
// bucket as login, so a stolen session cannot guess its way to a new password. The caller returns
// rather than throws on a mismatch, then throws a committing error, so the recorded failure stays.
export async function checkCurrentPassword(
  database: Database,
  user: { email: string; passwordHash: string },
  password: string,
) {
  await throttle(database, user.email, null);
  const matched = await verifyPassword(user.passwordHash, password);
  await recordLogin(database, user.email, null, matched);
  return matched;
}
// ADMIN-B22: recovery is throttled on the client address alone. The secret being guessed is the
// installation-wide RECOVERY_TOKEN, not a password, so an email bucket would protect nothing while
// handing an attacker a way to lock a named administrator out of ordinary login. Attempts are
// recorded without an email for the same reason. Where no trusted proxy is configured the address
// is unknown and no bucket applies; the token's enforced entropy floor is the control that holds.
export async function recover(
  handle: Database,
  input: z.infer<typeof Recovery>,
  ip: string | null,
) {
  const configured = env().RECOVERY_TOKEN;
  if (!configured) throw new AppError('not_found');
  await withTransaction(handle, async (database) => {
    await throttle(database, null, ip);
    await recordLogin(database, null, ip, false);
  });
  if (!matchesToken(input.token, digest(configured))) throw new AppError('forbidden', null, true);
  const passwordHash = await hashPassword(input.password);
  await withTransaction(handle, async (database) => {
    await lockWorkspace(database);
    if (await usedRecovery(database, digest(configured)))
      throw new AppError('conflict', { reason: 'state' });
    const user = await userByEmail(database, input.email);
    if (!user || user.role !== 'admin' || !user.isActive) throw new AppError('not_found');
    await recoverUser(database, user.id, digest(configured), passwordHash);
  });
}
