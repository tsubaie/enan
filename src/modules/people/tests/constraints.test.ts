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
const insert = (fullName: string | null, userId: string | null = null, personId = id()) =>
  db().run(
    sql`insert into people (id, full_name, user_id) values (${personId}, ${fullName}, ${userId})`,
  );
const linkedTo = (personId: string) =>
  db().get<{ userId: string | null }>(
    sql`select user_id as "userId" from people where id = ${personId}`,
  );
it('PEOPLE-I02 the database keeps one person per member and refuses a member it does not know', async () => {
  const actor = harness.user?.id ?? '';
  await expect(insert('Linked', actor)).resolves.toBeTruthy();
  expect(await violation(insert('Linked again', actor))).toMatchObject({
    kind: 'unique',
    columns: ['people.user_id'],
  });
  // The index is on the column, not partial: a deleted person keeps their member link, so a
  // second person cannot take the same login while the first sits in trash.
  await db().run(
    sql`update people set deleted_at = ${Date.now()}, deleted_op_id = ${id()} where user_id = ${actor}`,
  );
  expect(await violation(insert('Linked after trash', actor))).toMatchObject({ kind: 'unique' });
  expect(await violation(insert('Orphan link', id()))).toMatchObject({ kind: 'foreign_key' });
  // Two people with no login at all never collide on the link.
  await expect(insert('Unlinked one')).resolves.toBeTruthy();
  await expect(insert('Unlinked two')).resolves.toBeTruthy();
});
it('PEOPLE-I02 removing a member unlinks their person instead of taking the record with them', async () => {
  const member = await harness.account('member');
  const personId = id();
  await insert('Departed', member.id, personId);
  await db().run(sql`delete from users where id = ${member.id}`);
  expect(await linkedTo(personId)).toEqual({ userId: null });
});
it('PEOPLE-I01 the database refuses a missing or blank full name', async () => {
  expect(await violation(insert(null))).toMatchObject({
    kind: 'not_null',
    columns: ['people.full_name'],
  });
  expect(await violation(insert('   '))).toMatchObject({
    kind: 'check',
    constraint: 'people_full_name_check',
  });
  await expect(insert('  Spaced Name  ')).resolves.toBeTruthy();
});
it('PEOPLE-B01 a person is external and not assignable until said otherwise, and the kind is a closed list', async () => {
  const personId = id();
  await insert('Defaulted', null, personId);
  const row = await db().get<{ kind: string; isAssignable: number; tags: string }>(
    sql`select kind, is_assignable as "isAssignable", tags from people where id = ${personId}`,
  );
  expect(row).toEqual({ kind: 'external', isAssignable: 0, tags: '[]' });
  expect(
    await violation(
      db().run(sql`insert into people (id, full_name, kind) values (${id()}, 'Robot', 'robot')`),
    ),
  ).toMatchObject({ kind: 'check', constraint: 'people_kind_check' });
  await expect(
    db().run(sql`insert into people (id, full_name, kind) values (${id()}, 'Staff', 'internal')`),
  ).resolves.toBeTruthy();
});
it('PEOPLE-I05 a task keeps its owner column pointing at a person who is in trash', async () => {
  // Deletion is a soft delete, so the owner reference survives it; only a hard delete of the
  // person row clears it, and that is the schema's `on delete set null`, never a service path.
  const person = await harness.person('Owner', { isAssignable: true });
  const task = await harness.task('Owned', { ownerId: person.id });
  await db().run(
    sql`update people set deleted_at = ${Date.now()}, deleted_op_id = ${id()} where id = ${person.id}`,
  );
  const owned = await db().get<{ ownerId: string | null }>(
    sql`select owner_id as "ownerId" from tasks where id = ${task.id}`,
  );
  expect(owned).toEqual({ ownerId: person.id });
});
