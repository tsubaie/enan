import 'server-only';
import { transactional } from '@/core/db/transaction';
import { currentSessionHash, currentUser, type Context } from '@/core/auth/session';
import { db } from '@/core/db/client';
import { AppError } from '@/core/http/errors';
import { hashPassword } from '@/core/auth/password';
import { checkCurrentPassword } from '@/core/auth/login';
import {
  userById,
  userByEmail,
  updateUserAccount,
  userSessions,
  revokeOtherSessions,
  revokeOwnSession,
} from '@/core/db/auth-repo';
import { getSetting, hasSetting, writeSetting, clearSetting } from '@/core/db/settings-repo';
import { toJson, writeAudit } from '@/core/db/audit-repo';
import { personForUser } from '@/modules/people';
import type { Account, AccountPatch } from './schema/validation';
// ACCT-I01: every function here reads its subject from `ctx.user.id`. None takes a user id, which
// is what makes "another account" unreachable rather than merely unauthorised.
type Preference = 'locale' | 'timezone' | 'theme' | 'numerals';
const PREFERENCES: readonly Preference[] = ['locale', 'timezone', 'theme', 'numerals'];
// A template literal type rather than a cast: the four names compose into exactly the four
// user-scoped registry keys, and the compiler checks that rather than being told.
const settingKey = (name: Preference): `user.${Preference}` => `user.${name}`;
// The same concurrency token the rest of the app uses (04 § conventions). The entity helper cannot
// be reused here: it is built around a module's EntityOps, and the account is one row of a core
// table rather than an entity with a list, a trash and a restore.
function checkRevision(actual: number, supplied: number) {
  if (actual !== supplied) throw new AppError('conflict', { expected: actual });
}
export async function getAccount(ctx: Context): Promise<Account> {
  const user = await userById(ctx.db, ctx.user.id);
  if (!user) throw new AppError('not_found');
  const person = await personForUser(ctx, ctx.user.id);
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      revision: user.revision,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
    },
    person,
    preferences: await preferences(ctx),
    sessions: await sessions(ctx),
  };
}
async function preferences(ctx: Context) {
  const explicit: Preference[] = [];
  for (const name of PREFERENCES)
    if (await hasSetting(ctx.db, settingKey(name), ctx.user.id)) explicit.push(name);
  return {
    locale: await getSetting(ctx.db, 'user.locale', ctx.user.id),
    timezone: await getSetting(ctx.db, 'user.timezone', ctx.user.id),
    theme: await getSetting(ctx.db, 'user.theme', ctx.user.id),
    numerals: await getSetting(ctx.db, 'user.numerals', ctx.user.id),
    explicit,
  };
}
// ACCT-B03: the current session is the one whose token hash matches the cookie this request
// arrived with, so it can be marked without trusting anything the client sent as an id.
async function sessions(ctx: Context) {
  const rows = await userSessions(ctx.db, ctx.user.id);
  const current = await currentSessionHash();
  return rows.map((row) => ({
    id: row.id,
    current: row.tokenHash === current,
    issuedAt: row.issuedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    ip: row.ip,
    userAgent: row.userAgent,
  }));
}
// ACCT-B01/B04: the name and the four preferences. A preference set to the empty string clears the
// reader's row so the workspace default reaches them again (ACCT-I03); it is never copied.
export const patchAccount = transactional(async function patchAccount(
  ctx: Context,
  patch: AccountPatch,
) {
  const user = await userById(ctx.db, ctx.user.id);
  if (!user) throw new AppError('not_found');
  checkRevision(user.revision, patch.revision);
  for (const name of PREFERENCES) {
    const value = patch[name];
    if (value === undefined) continue;
    if (value === '') await clearSetting(ctx.db, settingKey(name), ctx.user.id);
    else await writeSetting(ctx.db, settingKey(name), value, ctx.user.id, ctx.user.id);
  }
  if (patch.name !== undefined && patch.name !== user.name) {
    const updated = await updateUserAccount(ctx.db, ctx.user.id, {
      name: patch.name,
      revision: user.revision + 1,
    });
    await writeAudit(
      ctx.db,
      ctx.user.id,
      'account.renamed',
      'user',
      ctx.user.id,
      toJson({ name: { from: user.name, to: updated?.name } }),
    );
  }
  return getAccount(ctx);
});
// ACCT-B01: the address is lowercased by the schema and the unique index is the real guard; this
// check exists so the reader gets a field error instead of a constraint violation. The email is
// half of the sign-in credentials, so changing it needs the current password, as ACCT-B02 does.
// A wrong current password is answered after the attempt it recorded commits (ADMIN-B20): the
// work returns `null` inside its savepoint, and the caller throws a committing error.
const wrongPassword = () =>
  new AppError('validation_failed', { fieldErrors: { current: ['password_incorrect'] } }, true);
const emailChange = transactional(async function changeEmail(
  ctx: Context,
  revision: number,
  email: string,
  current: string,
) {
  const user = await userById(ctx.db, ctx.user.id);
  if (!user) throw new AppError('not_found');
  checkRevision(user.revision, revision);
  if (!(await checkCurrentPassword(ctx.db, user, current))) return null;
  if (email === user.email) return getAccount(ctx);
  const taken = await userByEmail(ctx.db, email);
  if (taken) throw new AppError('validation_failed', { fieldErrors: { email: ['email_taken'] } });
  await updateUserAccount(ctx.db, ctx.user.id, { email, revision: user.revision + 1 });
  await writeAudit(
    ctx.db,
    ctx.user.id,
    'account.email_changed',
    'user',
    ctx.user.id,
    toJson({ email: { from: user.email, to: email } }),
  );
  return getAccount(ctx);
});
export async function changeEmail(...args: Parameters<typeof emailChange>) {
  const account = await emailChange(...args);
  if (!account) throw wrongPassword();
  return account;
}
// ACCT-B02: the current password is required, and on success every other session is revoked while
// the one making the request survives. Signing the reader out of the tab they just used to change
// their password would be a punishment for doing the right thing; leaving the other devices signed
// in would defeat the point of changing it.
const passwordChange = transactional(async function changePassword(
  ctx: Context,
  current: string,
  next: string,
) {
  const user = await userById(ctx.db, ctx.user.id);
  if (!user) throw new AppError('not_found');
  if (!(await checkCurrentPassword(ctx.db, user, current))) return null;
  await updateUserAccount(ctx.db, ctx.user.id, {
    passwordHash: await hashPassword(next),
    passwordChangedAt: new Date(),
    revision: user.revision + 1,
  });
  const revoked = await revokeOtherSessions(
    ctx.db,
    ctx.user.id,
    (await currentSessionHash()) ?? '',
  );
  // The diff records that sessions were ended and how many; it never records either password.
  await writeAudit(
    ctx.db,
    ctx.user.id,
    'account.password_changed',
    'user',
    ctx.user.id,
    toJson({ sessionsRevoked: revoked }),
  );
  return { revoked };
});
export async function changePassword(...args: Parameters<typeof passwordChange>) {
  const result = await passwordChange(...args);
  if (!result) throw wrongPassword();
  return result;
}
export const signOutOthers = transactional(async function signOutOthers(ctx: Context) {
  const revoked = await revokeOtherSessions(
    ctx.db,
    ctx.user.id,
    (await currentSessionHash()) ?? '',
  );
  return { revoked };
});
// The session id is the reader's own or it revokes nothing: the update is scoped by user id, so an
// id lifted from somewhere else matches no row rather than matching someone else's.
export const revokeSessionById = transactional(async function revokeSessionById(
  ctx: Context,
  sessionId: string,
) {
  const done = await revokeOwnSession(ctx.db, ctx.user.id, sessionId);
  if (!done) throw new AppError('not_found');
  return { id: sessionId };
});
// ACCT-B04: the theme the page is drawn in. Read on the server for every render, so it holds on
// every device the reader signs in on; dark before sign-in and while the reader has not chosen.
export async function readerTheme() {
  try {
    const user = await currentUser();
    return user ? await getSetting(db(), 'user.theme', user.id) : 'dark';
  } catch {
    return 'dark';
  }
}
// ACCT-B04: the language the reader sees: their own choice, else the workspace default.
export async function readerLocale(ctx: Context) {
  return (await hasSetting(ctx.db, 'user.locale', ctx.user.id))
    ? getSetting(ctx.db, 'user.locale', ctx.user.id)
    : getSetting(ctx.db, 'workspace.default_locale');
}
