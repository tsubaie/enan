import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { closeDatabase, db } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import journal from '../../../../drizzle/meta/_journal.json';
import {
  CaptureStatus,
  FieldState,
  FieldStateEntry,
  LiveEntityType,
  SourceSpan,
  SuggestionContent,
  SuggestionKind,
  SuggestionStatus,
} from '../schema/validation';
import { audioFile, user } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
it('CAPTURES-I01 the contracts name the lifecycle, the kinds and the three field states', () => {
  expect(CaptureStatus.options).toEqual([
    'queued',
    'transcribing',
    'interpreting',
    'ready',
    'needs_transcript',
    'failed',
  ]);
  expect(SuggestionKind.options).toEqual(['task', 'meeting_note', 'committee_note']);
  expect(SuggestionStatus.options).toEqual(['pending', 'approved', 'discarded', 'merged']);
  expect(LiveEntityType.options).toEqual(['task', 'note']);
  expect(FieldState.options).toEqual(['confident', 'several', 'unknown']);
});
it('CAPTURES-B09 a field state is a word with candidates, never a percentage', () => {
  expect(FieldStateEntry.parse({ state: 'several', candidates: [id(), id()] })).toMatchObject({
    state: 'several',
  });
  expect(FieldStateEntry.safeParse({ state: 'confident', confidence: 0.9 }).success).toBe(false);
  expect(FieldStateEntry.safeParse({ state: '90%' }).success).toBe(false);
});
it('CAPTURES-I01 a payload must fit its kind, and a source span must run forwards', () => {
  const task = SuggestionContent.parse({ kind: 'task', payload: { title: ' Send the budget ' } });
  expect(task).toMatchObject({
    kind: 'task',
    payload: { title: 'Send the budget', ownerId: null, status: 'inbox', priority: null },
    fieldStates: {},
    sourceSpans: [],
    typeFlag: null,
  });
  expect(SuggestionContent.safeParse({ kind: 'task', payload: { body: 'x' } }).success).toBe(false);
  expect(
    SuggestionContent.safeParse({ kind: 'meeting_note', payload: { title: 'Board' } }).success,
  ).toBe(false);
  const committee = SuggestionContent.parse({
    kind: 'committee_note',
    payload: { title: 'Audit', body: 'Agreed the plan.' },
  });
  // Unresolved required fields are held as null for the reviewer, not invented.
  expect(committee.payload).toMatchObject({ committeeId: null, noteDate: null });
  expect(
    SuggestionContent.safeParse({ kind: 'task', payload: { title: 'x', status: 'completed' } })
      .success,
  ).toBe(false);
  expect(SourceSpan.safeParse({ start: 4, end: 4 }).success).toBe(false);
  expect(SourceSpan.safeParse({ start: 0, end: 12 }).success).toBe(true);
});
const foreignKeys = (table: string) =>
  db().all<{ table: string; from: string; on_delete: string }>(
    sql`select "table", "from", on_delete from pragma_foreign_key_list(${table}) order by "from"`,
  );
it('CAPTURES-I01 the tables reference audio, committees, jobs and their capture as specified', async () => {
  expect(await foreignKeys('captures')).toEqual([
    { table: 'committees', from: 'context_committee_id', on_delete: 'SET NULL' },
    { table: 'users', from: 'created_by', on_delete: 'NO ACTION' },
    { table: 'files', from: 'file_id', on_delete: 'RESTRICT' },
    { table: 'jobs', from: 'interpret_job_id', on_delete: 'SET NULL' },
    { table: 'jobs', from: 'transcribe_job_id', on_delete: 'SET NULL' },
    { table: 'users', from: 'updated_by', on_delete: 'NO ACTION' },
  ]);
  expect(await foreignKeys('capture_suggestions')).toEqual([
    { table: 'users', from: 'approved_by', on_delete: 'NO ACTION' },
    { table: 'captures', from: 'capture_id', on_delete: 'CASCADE' },
    { table: 'users', from: 'created_by', on_delete: 'NO ACTION' },
    { table: 'capture_suggestions', from: 'merge_target_id', on_delete: 'NO ACTION' },
  ]);
  const ddl = await db().all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'table' and name in ('captures', 'capture_suggestions')`,
  );
  const of = (name: string) => ddl.find((row) => row.name === name)?.sql ?? '';
  for (const option of CaptureStatus.options) expect(of('captures')).toContain(`'${option}'`);
  for (const option of [...SuggestionKind.options, ...SuggestionStatus.options])
    expect(of('capture_suggestions')).toContain(`'${option}'`);
});
// Runs one migration's statements again, on a database the previous release left.
async function rerun(tag: string) {
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  const migration = readMigrationFiles({ migrationsFolder: './drizzle' })[index];
  for (const statement of migration?.sql ?? []) await db().run(sql.raw(statement));
}
it('CAPTURES-I01 the migration leaves existing voice memos untouched and backfills no captures', async () => {
  const recorder = await user('Memo Recorder', 'member');
  const file = await audioFile();
  const noteId = id();
  const memoId = id();
  await db().run(
    sql`insert into notes (id, title, content, note_date, tags, created_by) values (${noteId}, 'Debrief', 'Spoken words', '2026-11-01', '[]', ${recorder.id})`,
  );
  await db().run(
    sql`insert into note_voice_memos (id, note_id, file_id, duration_seconds, transcript, transcription_status, created_by) values (${memoId}, ${noteId}, ${file.id}, 74, 'Spoken words', 'done', ${recorder.id})`,
  );
  const memos = () => db().all(sql`select * from note_voice_memos order by id`);
  const notes = () => db().all(sql`select * from notes order by id`);
  const before = { memos: await memos(), notes: await notes() };
  await db().run(sql`drop table capture_suggestions`);
  await db().run(sql`drop table captures`);
  await rerun('0021_captures');
  expect({ memos: await memos(), notes: await notes() }).toEqual(before);
  const [captures] = await db().all<{ count: number }>(sql`select count(*) as count from captures`);
  const [drafts] = await db().all<{ count: number }>(
    sql`select count(*) as count from capture_suggestions`,
  );
  expect([captures?.count, drafts?.count]).toEqual([0, 0]);
});
