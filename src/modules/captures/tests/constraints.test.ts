import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { constraintViolation } from '@/core/db/errors';
import { files } from '@/core/db/system-schema';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { captures, captureSuggestions } from '../schema/db';
import { capture, suggestion, user } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
// The constraint SQLite reported, or null when the statement went through (ADR 0029).
const violation = <T>(statement: Promise<T>) =>
  statement.then(
    () => null,
    (error: Error) => constraintViolation(error),
  );
it('CAPTURES-I01 the database keeps a duration between zero and fifteen minutes', async () => {
  const recorder = await user('Recorder', 'member');
  await expect(capture(recorder, { durationSeconds: 900 })).resolves.toMatchObject({
    durationSeconds: 900,
    status: 'queued',
    revision: 1,
  });
  expect(await violation(capture(recorder, { durationSeconds: 901 }))).toMatchObject({
    kind: 'check',
    constraint: 'captures_duration_check',
  });
  expect(await violation(capture(recorder, { durationSeconds: -1 }))).toMatchObject({
    kind: 'check',
    constraint: 'captures_duration_check',
  });
});
it('CAPTURES-I01 the database refuses a status, kind or live type outside the contract', async () => {
  const recorder = await user('Recorder', 'member');
  expect(await violation(capture(recorder, { status: 'approved' }))).toMatchObject({
    kind: 'check',
    constraint: 'captures_status_check',
  });
  const row = await capture(recorder, { status: 'ready' });
  const cases = [
    [{ kind: 'meeting' }, 'capture_suggestions_kind_check'],
    [{ status: 'live' }, 'capture_suggestions_status_check'],
    [{ typeFlag: 'reminder' }, 'capture_suggestions_type_flag_check'],
    [{ liveEntityType: 'meeting' }, 'capture_suggestions_live_type_check'],
  ] as const;
  for (const [fields, constraint] of cases)
    expect(await violation(suggestion(row.id, fields))).toMatchObject({
      kind: 'check',
      constraint,
    });
  await expect(suggestion(row.id, { typeFlag: null })).resolves.toMatchObject({
    status: 'pending',
    fieldStates: {},
    sourceSpans: [],
  });
});
it('CAPTURES-I01 a capture keeps its audio file, and its drafts go with it when purged', async () => {
  const recorder = await user('Recorder', 'member');
  const row = await capture(recorder);
  await suggestion(row.id);
  // ON DELETE RESTRICT: SQLite refuses the delete outright.
  expect(await violation(db().delete(files).where(eq(files.id, row.fileId)))).not.toBeNull();
  await db().delete(captures).where(eq(captures.id, row.id));
  const [left] = await db()
    .select({ count: sql<number>`count(*)` })
    .from(captureSuggestions)
    .where(eq(captureSuggestions.captureId, row.id));
  expect(left?.count).toBe(0);
  expect(await db().select().from(files).where(eq(files.id, row.fileId))).toHaveLength(1);
});
