import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { closeDatabase, db, withTransaction, type Database } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { insertUser, insertSession } from '@/core/db/auth-repo';
import { users, sessions, settings } from '@/core/db/system-schema';
import { getSetting, writeSetting } from '@/core/db/settings-repo';
import { hashPassword } from '@/core/auth/password';
import { User } from '@/core/http/user-schema';
import { id } from '@/core/db/ids';
import * as service from '../service';
import { AccountPatch } from '../schema/validation';
// The account identifies its own session by the cookie the request arrived with, so the scenarios
// control what that cookie is rather than going through the HTTP layer to set one.
const currentHash = vi.hoisted(() => ({ value: 'session-hash-current' }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentSessionHash: async () => currentHash.value,
}));
type Ctx = { db: Database; user: User; requestId: string };
let actor: User;
const run = <T>(action: (ctx: Ctx) => Promise<T>) =>
  withTransaction(db(), (database) => action({ db: database, user: actor, requestId: id() }));
async function session(tokenHash: string) {
  const now = new Date();
  await insertSession(db(), {
    id: id(),
    userId: actor.id,
    tokenHash,
    issuedAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    absoluteExpiresAt: new Date(now.getTime() + 86_400_000),
  });
}
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(async () => {
  currentHash.value = 'session-hash-current';
  await clearDatabase();
  actor = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Account Holder',
      email: 'holder@example.test',
      passwordHash: await hashPassword('correct horse battery'),
      role: 'admin',
    }),
  );
});
afterAll(() => closeDatabase());

it('ACCT-B01 rejects an address another account already holds, on that field', async () => {
  await insertUser(db(), {
    id: id(),
    name: 'Someone Else',
    email: 'taken@example.test',
    passwordHash: 'unused',
    role: 'member',
  });
  await expect(
    run((ctx) => service.changeEmail(ctx, 1, 'taken@example.test', 'correct horse battery')),
  ).rejects.toMatchObject({ details: { fieldErrors: { email: ['email_taken'] } } });
});

it('ACCT-B01 lowercases a changed address', async () => {
  await run((ctx) =>
    service.changeEmail(ctx, 1, 'Holder.New@Example.Test'.toLowerCase(), 'correct horse battery'),
  );
  const [row] = await db().select().from(users).where(eq(users.id, actor.id));
  expect(row?.email).toBe('holder.new@example.test');
});

it('ACCT-B01 refuses an email change with a wrong current password and changes nothing', async () => {
  await expect(
    run((ctx) => service.changeEmail(ctx, 1, 'thief@example.test', 'not the password')),
  ).rejects.toMatchObject({ details: { fieldErrors: { current: ['password_incorrect'] } } });
  const [row] = await db().select().from(users).where(eq(users.id, actor.id));
  expect(row?.email).not.toBe('thief@example.test');
});

it('ACCT-B02 refuses a wrong current password and changes nothing', async () => {
  const before = await db().select().from(users).where(eq(users.id, actor.id));
  await expect(
    run((ctx) => service.changePassword(ctx, 'not the password', 'a new long password')),
  ).rejects.toMatchObject({ details: { fieldErrors: { current: ['password_incorrect'] } } });
  const after = await db().select().from(users).where(eq(users.id, actor.id));
  expect(after[0]?.passwordHash).toBe(before[0]?.passwordHash);
});

it('ADMIN-B20 ACCT-B02 wrong current passwords count like failed logins: the sixth try is refused', async () => {
  // As the handler does: a committing error keeps the attempt the service recorded.
  const attempt = (password: string) =>
    run((ctx) => service.changePassword(ctx, password, 'a new long password').catch((e) => e));
  for (let i = 0; i < 5; i += 1)
    expect(await attempt('not the password')).toMatchObject({ code: 'validation_failed' });
  expect(await attempt('correct horse battery')).toMatchObject({ code: 'rate_limited' });
  const email = (password: string) =>
    run((ctx) => service.changeEmail(ctx, 1, 'thief@example.test', password).catch((e) => e));
  expect(await email('correct horse battery')).toMatchObject({ code: 'rate_limited' });
});

it('ACCT-B02 keeps the session it was made in and revokes every other', async () => {
  await session('session-hash-current');
  await session('session-hash-other-1');
  await session('session-hash-other-2');
  const result = await run((ctx) =>
    service.changePassword(ctx, 'correct horse battery', 'a new long password'),
  );
  expect(result.revoked).toBe(2);
  const live = await db()
    .select()
    .from(sessions)
    .where(sql`${sessions.revokedAt} is null`);
  expect(live.map((row) => row.tokenHash)).toEqual(['session-hash-current']);
});

it('ACCT-B03 marks the requesting session as the current one', async () => {
  await session('session-hash-current');
  await session('session-hash-other');
  const account = await run((ctx) => service.getAccount(ctx));
  const current = account.sessions.filter((row) => row.current);
  expect(current).toHaveLength(1);
  expect(account.sessions).toHaveLength(2);
});

it('ACCT-B03 revokes only the reader own session, never one belonging to someone else', async () => {
  const other = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Other',
      email: 'other@example.test',
      passwordHash: 'unused',
      role: 'member',
    }),
  );
  const theirs = id();
  const now = new Date();
  await insertSession(db(), {
    id: theirs,
    userId: other.id,
    tokenHash: 'theirs',
    issuedAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    absoluteExpiresAt: new Date(now.getTime() + 86_400_000),
  });
  await expect(run((ctx) => service.revokeSessionById(ctx, theirs))).rejects.toMatchObject({
    code: 'not_found',
  });
  const [row] = await db().select().from(sessions).where(eq(sessions.id, theirs));
  expect(row?.revokedAt).toBeNull();
});

it('ACCT-I03 clearing a preference removes the row so the workspace default reaches the reader', async () => {
  await run((ctx) => service.patchAccount(ctx, AccountPatch.parse({ revision: 1, locale: 'ar' })));
  expect(await getSetting(db(), 'user.locale', actor.id)).toBe('ar');
  await writeSetting(db(), 'workspace.default_locale', 'ar', actor.id);
  const revision =
    (await db().select().from(users).where(eq(users.id, actor.id)))[0]?.revision ?? 1;
  await run((ctx) => service.patchAccount(ctx, AccountPatch.parse({ revision, locale: '' })));
  const rows = await db()
    .select()
    .from(settings)
    .where(and(eq(settings.key, 'user.locale'), eq(settings.userId, actor.id)));
  expect(rows).toHaveLength(0);
});

it('ACCT-I02 has no way to name a role or an active flag in a patch', () => {
  expect(() => AccountPatch.parse({ revision: 1, role: 'admin' })).toThrow();
  expect(() => AccountPatch.parse({ revision: 1, isActive: false })).toThrow();
});
