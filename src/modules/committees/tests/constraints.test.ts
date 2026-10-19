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
type Row = { id?: string; name?: string; scope?: string; status?: string; sortOrder?: number };
// A raw insert bypassing the service, so the database is the only thing standing in the way.
const insert = (row: Row) =>
  db().run(
    sql`insert into committees (id, name, scope, status, sort_order) values (${row.id ?? id()},
      ${row.name ?? 'Raw'}, ${row.scope ?? 'internal'}, ${row.status ?? 'active'}, ${row.sortOrder ?? 0})`,
  );
it('COMM-I01 the database keeps one live committee per case-folded name and frees it on soft delete', async () => {
  const finance = await harness.committee('Finance');
  const duplicate = await violation(insert({ name: 'FINANCE' }));
  expect(duplicate).toMatchObject({ kind: 'unique' });
  // The index is partial, so the trashed body no longer holds the name.
  await db().run(
    sql`update committees set deleted_at = ${Date.now()}, deleted_op_id = ${id()} where id = ${finance.id}`,
  );
  await expect(insert({ name: 'finance' })).resolves.toBeTruthy();
  // ...and the trashed row cannot be brought back while the name is taken.
  expect(
    await violation(
      db().run(
        sql`update committees set deleted_at = null, deleted_op_id = null where id = ${finance.id}`,
      ),
    ),
  ).toMatchObject({ kind: 'unique' });
});
it('COMM-B01 the database holds the scope and status vocabularies, a non-blank name and a non-negative position', async () => {
  expect(await violation(insert({ scope: 'regional' }))).toMatchObject({
    kind: 'check',
    constraint: 'committees_scope_check',
  });
  expect(await violation(insert({ status: 'dissolved' }))).toMatchObject({
    kind: 'check',
    constraint: 'committees_status_check',
  });
  expect(await violation(insert({ name: '   ' }))).toMatchObject({
    kind: 'check',
    constraint: 'committees_name_check',
  });
  expect(await violation(insert({ name: 'n'.repeat(501) }))).toMatchObject({
    kind: 'check',
    constraint: 'committees_name_check',
  });
  expect(await violation(insert({ sortOrder: -1 }))).toMatchObject({
    kind: 'check',
    constraint: 'committees_order_check',
  });
  await expect(
    insert({ scope: 'external', status: 'archived', sortOrder: 7 }),
  ).resolves.toBeTruthy();
});
it('COMM-I02 COMM-I03 tasks and notes must name an existing committee, keep it through archive and soft delete, and lose it only on purge', async () => {
  const unknown = id();
  expect(
    await violation(
      db().run(
        sql`insert into tasks (id, title, sort_order, committee_id) values (${id()}, 'Orphan', 0, ${unknown})`,
      ),
    ),
  ).toMatchObject({ kind: 'foreign_key' });
  expect(
    await violation(
      db().run(
        sql`insert into notes (id, title, note_date, committee_id) values (${id()}, 'Orphan', '2026-09-10', ${unknown})`,
      ),
    ),
  ).toMatchObject({ kind: 'foreign_key' });
  const committee = await harness.committee('Finance');
  const task = await harness.task('Action', { committeeId: committee.id });
  const note = await harness.note('Minutes', { committeeId: committee.id });
  const links = () =>
    db().get<{ task: string | null; note: string | null }>(
      sql`select (select committee_id from tasks where id = ${task.id}) as task,
        (select committee_id from notes where id = ${note.id}) as note`,
    );
  await db().run(sql`update committees set status = 'archived' where id = ${committee.id}`);
  expect(await links()).toEqual({ task: committee.id, note: committee.id });
  await db().run(
    sql`update committees set deleted_at = ${Date.now()}, deleted_op_id = ${id()} where id = ${committee.id}`,
  );
  expect(await links()).toEqual({ task: committee.id, note: committee.id });
  await db().run(sql`delete from committees where id = ${committee.id}`);
  expect(await links()).toEqual({ task: null, note: null });
  // The work itself is untouched by the purge.
  const remaining = await db().get<{ count: number }>(
    sql`select (select count(*) from tasks where id = ${task.id}) + (select count(*) from notes where id = ${note.id}) as count`,
  );
  expect(remaining?.count).toBe(2);
});
