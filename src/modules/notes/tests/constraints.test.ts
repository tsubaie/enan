import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { constraintViolation } from '@/core/db/errors';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { harness } from './fixtures';
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
// The constraint SQLite reported, or null when the statement went through (ADR 0029).
const violation = <T>(statement: Promise<T>) =>
  statement.then(
    () => null,
    (error: Error) => constraintViolation(error),
  );
const insert = (title: string, tags: string[]) =>
  db().run(
    sql`insert into notes (id, title, type, note_date, tags) values (${id()}, ${title}, null, '2026-09-10', ${JSON.stringify(tags)})`,
  );
const participant = (noteId: string, personId: string) =>
  db().run(
    sql`insert into note_people (id, note_id, person_id) values (${id()}, ${noteId}, ${personId})`,
  );
it('NOTES-I01 NOTES-I03 the database rejects blank titles and more than ten tags', async () => {
  expect(await violation(insert('   ', []))).toMatchObject({
    kind: 'check',
    constraint: 'notes_title_check',
  });
  expect(await violation(insert('ok', 'abcdefghijk'.split('')))).toMatchObject({
    kind: 'check',
    constraint: 'notes_tags_check',
  });
  await expect(insert('ok', 'abcdefghij'.split(''))).resolves.toBeTruthy();
});
it('NOTES-I04 the database rejects a second active participant row for the same person', async () => {
  const who = await harness.person('Twice');
  const created = await harness.note('Meeting', { participantIds: [who.id] });
  expect(await violation(participant(created.id, who.id))).toMatchObject({
    kind: 'unique',
    columns: ['note_people.note_id', 'note_people.person_id'],
  });
  await db().run(
    sql`update note_people set deleted_at = ${Date.now()}, deleted_op_id = ${id()} where note_id = ${created.id}`,
  );
  await expect(participant(created.id, who.id)).resolves.toBeTruthy();
});
it('NOTES-I06 purging a note nulls source_note_id on its tasks and removes its participant rows', async () => {
  const who = await harness.person('Present');
  const created = await harness.note('Purge me', { participantIds: [who.id] });
  const linked = await harness.task('Linked', { sourceNoteId: created.id });
  await db().run(sql`delete from notes where id = ${created.id}`);
  const task = await db().get<{ source_note_id: string | null }>(
    sql`select source_note_id from tasks where id = ${linked.id}`,
  );
  expect(task?.source_note_id).toBeNull();
  const count = await db().get<{ count: number }>(
    sql`select count(*) as count from note_people where note_id = ${created.id}`,
  );
  expect(count?.count).toBe(0);
});
