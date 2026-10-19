import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { constraintViolation } from '@/core/db/errors';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { harness } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
// The constraint SQLite reported, or null when the statement went through (ADR 0029).
const violation = <T>(statement: Promise<T>) =>
  statement.then(
    () => null,
    (error: Error) => constraintViolation(error),
  );
const user = (email: string, role = 'member') =>
  db().run(
    sql`insert into users (id, email, name, password_hash, role) values (${id()}, ${email}, ${email}, 'hash', ${role})`,
  );
const person = (userId: string | null) =>
  db().run(
    sql`insert into people (id, full_name, user_id) values (${id()}, 'Linked Person', ${userId})`,
  );
it('ADMIN-B03 the database keeps one account per email address, stored in lower case', async () => {
  await expect(user('dana@example.test')).resolves.toBeTruthy();
  expect(await violation(user('dana@example.test', 'admin'))).toMatchObject({
    kind: 'unique',
    columns: ['users.email'],
  });
  // The service lower-cases before writing; the table refuses what a bypass might send.
  expect(await violation(user('Dana@Example.test'))).toMatchObject({
    kind: 'check',
    constraint: 'users_email_lower_check',
  });
});
it('ADMIN-B03 ADMIN-B04 the database admits only the two roles the last-admin count relies on', async () => {
  expect(await violation(user('owner@example.test', 'owner'))).toMatchObject({
    kind: 'check',
    constraint: 'users_role_check',
  });
  await expect(user('member@example.test', 'member')).resolves.toBeTruthy();
  await expect(user('second@example.test', 'admin')).resolves.toBeTruthy();
  expect(
    await violation(
      db().run(
        sql`insert into users (id, email, password_hash, role) values (${id()}, 'x@example.test', 'hash', 'member')`,
      ),
    ),
  ).toMatchObject({ kind: 'not_null', columns: ['users.name'] });
});
it('ADMIN-B06 the database keeps the person-to-user link one-to-one and pointing at a real account', async () => {
  const admin = harness.user;
  if (!admin) throw new Error('harness not reset');
  await expect(person(admin.id)).resolves.toBeTruthy();
  expect(await violation(person(admin.id))).toMatchObject({
    kind: 'unique',
    columns: ['people.user_id'],
  });
  expect(await violation(person(id()))).toMatchObject({ kind: 'foreign_key' });
  // Unlinked people are not a link, so any number of them may share the absence.
  await expect(person(null)).resolves.toBeTruthy();
  await expect(person(null)).resolves.toBeTruthy();
});
it('ADMIN-B02 the database records a recovery token hash once, which is what makes a second use refusable', async () => {
  const hash = `hash-${id()}`;
  const use = () => db().run(sql`insert into recovery_token_uses (token_hash) values (${hash})`);
  await expect(use()).resolves.toBeTruthy();
  expect(await violation(use())).toMatchObject({
    kind: 'unique',
    columns: ['recovery_token_uses.token_hash'],
  });
});
it('ADMIN-B03 a session belongs to an existing account and leaves with it', async () => {
  const insert = (userId: string) =>
    db().run(
      sql`insert into sessions (id, user_id, token_hash, issued_at, last_seen_at, expires_at, absolute_expires_at) values (${id()}, ${userId}, ${id()}, ${Date.now()}, ${Date.now()}, ${Date.now() + 1000}, ${Date.now() + 2000})`,
    );
  expect(await violation(insert(id()))).toMatchObject({ kind: 'foreign_key' });
  const admin = harness.user;
  if (!admin) throw new Error('harness not reset');
  await expect(insert(admin.id)).resolves.toBeTruthy();
  await db().run(sql`delete from users where id = ${admin.id}`);
  const row = await db().get<{ count: number }>(sql`select count(*) as count from sessions`);
  expect(row?.count).toBe(0);
});
