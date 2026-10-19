import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { constraintViolation } from '@/core/db/errors';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
// The account is a view over `users`, `sessions` and `settings` (docs/features/account.md § Data
// model). These scenarios reach past the service and ask the database itself to keep the facts the
// service relies on: a lowercase, unique address; one row per preference; a user row behind every
// session and every user-scoped setting.
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  await insertUser(holder, 'holder@example.test');
});
afterAll(() => closeDatabase());
const holder = id();
const violation = <T>(statement: Promise<T>) =>
  statement.then(
    () => null,
    (error: Error) => constraintViolation(error),
  );
const insertUser = (userId: string, email: string) =>
  db().run(
    sql`insert into users (id, email, name, password_hash, role) values (${userId}, ${email}, 'Holder', 'unused', 'member')`,
  );
const insertSetting = (key: string, scope: string, userId: string | null, value = '"ar"') =>
  db().run(
    sql`insert into settings (key, scope, user_id, value) values (${key}, ${scope}, ${userId}, ${value})`,
  );
const insertSession = (userId: string, tokenHash: string) =>
  db().run(
    sql`insert into sessions (id, user_id, token_hash, issued_at, last_seen_at, expires_at, absolute_expires_at) values (${id()}, ${userId}, ${tokenHash}, ${Date.now()}, ${Date.now()}, ${Date.now() + 86_400_000}, ${Date.now() + 86_400_000})`,
  );
it('ACCT-B01 the database refuses an address with capitals and a second account on the same address', async () => {
  expect(await violation(insertUser(id(), 'Mixed.Case@example.test'))).toMatchObject({
    kind: 'check',
    constraint: 'users_email_lower_check',
  });
  expect(await violation(insertUser(id(), 'holder@example.test'))).toMatchObject({
    kind: 'unique',
    columns: ['users.email'],
  });
  await expect(insertUser(id(), 'second@example.test')).resolves.toBeTruthy();
});
it('ACCT-B04 ACCT-I03 a preference row names its owner and a workspace row names none', async () => {
  // The scope and the owner are paired by a check constraint, so "user scope, no user" and
  // "workspace scope, some user" are both impossible to store.
  expect(await violation(insertSetting('user.locale', 'user', null))).toMatchObject({
    kind: 'check',
    constraint: 'settings_scope_owner_check',
  });
  expect(await violation(insertSetting('user.locale', 'workspace', holder))).toMatchObject({
    kind: 'check',
    constraint: 'settings_scope_owner_check',
  });
  await expect(insertSetting('user.locale', 'user', holder)).resolves.toBeTruthy();
  await expect(insertSetting('workspace.default_locale', 'workspace', null)).resolves.toBeTruthy();
});
it('ACCT-B04 ACCT-I03 one row per preference per reader, beside the workspace row of the same key', async () => {
  await insertSetting('user.theme', 'user', holder, '"dark"');
  // A second row for the same reader and key would make "clear the row" ambiguous.
  expect(await violation(insertSetting('user.theme', 'user', holder, '"light"'))).toMatchObject({
    kind: 'unique',
  });
  // The index coalesces the null owner, so another reader and the workspace itself each keep
  // their own row under the same key.
  const other = id();
  await insertUser(other, 'other@example.test');
  await expect(insertSetting('user.theme', 'user', other, '"light"')).resolves.toBeTruthy();
  await expect(insertSetting('user.theme', 'workspace', null, '"light"')).resolves.toBeTruthy();
});
it('ACCT-I01 a preference row and a session row both point at a real account', async () => {
  const nobody = id();
  expect(await violation(insertSetting('user.locale', 'user', nobody))).toMatchObject({
    kind: 'foreign_key',
  });
  expect(await violation(insertSession(nobody, 'orphan-hash'))).toMatchObject({
    kind: 'foreign_key',
  });
});
it('ACCT-B03 the database keeps one session per token and lets a revoked session stay on record', async () => {
  await insertSession(holder, 'device-a');
  expect(await violation(insertSession(holder, 'device-a'))).toMatchObject({
    kind: 'unique',
    columns: ['sessions.token_hash'],
  });
  await db().run(sql`update sessions set revoked_at = ${Date.now()} where token_hash = 'device-a'`);
  // Revocation is a timestamp, not a deletion: the row remains and the token stays taken.
  expect(await violation(insertSession(holder, 'device-a'))).toMatchObject({ kind: 'unique' });
  const rows = await db().all(sql`select revoked_at from sessions where token_hash = 'device-a'`);
  expect(rows).toHaveLength(1);
});
it('ACCT-B07 removing an account takes its sessions and preferences with it', async () => {
  await insertSession(holder, 'device-a');
  await insertSetting('user.locale', 'user', holder);
  await db().run(sql`delete from users where id = ${holder}`);
  expect(await db().all(sql`select id from sessions where user_id = ${holder}`)).toEqual([]);
  expect(await db().all(sql`select key from settings where user_id = ${holder}`)).toEqual([]);
});
