import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { jobs } from '@/core/db/system-schema';
import type { User } from '@/core/http/user-schema';
import * as repo from '../repo';
import { capture, suggestion, user } from './fixtures';
// CAPTURES-B02: the repository's reads against the real database. Every read goes through one
// visibility predicate: the recorder's own live captures, or any live capture for an admin.
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
let recorder: User;
let other: User;
let admin: User;
beforeEach(async () => {
  recorder = await user('Recorder', 'member');
  other = await user('Other', 'member');
  admin = await user('Admin', 'admin');
});
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 9, minutes));
const listed = async (
  reader: User,
  limit = 50,
  after: { createdAt: Date; id: string } | null = null,
  scope: 'mine' | 'all' = 'mine',
) => (await repo.selectCaptures(db(), reader, limit, after, scope)).map((row) => row.id);
it('CAPTURES-B02 a list shows the recorder their own live captures, an admin every live one when asking for all, and no one a deleted one', async () => {
  const own = await capture(recorder, { createdAt: at(1) });
  const theirs = await capture(other, { createdAt: at(2) });
  await capture(recorder, { createdAt: at(3), deletedAt: at(4) });
  expect(await listed(recorder)).toEqual([own.id]);
  expect(await listed(other)).toEqual([theirs.id]);
  expect(await listed(other, 50, null, 'all')).toEqual([theirs.id]);
  expect(await listed(admin)).toEqual([]);
  expect(await listed(admin, 50, null, 'all')).toEqual([theirs.id, own.id]);
});
it('CAPTURES-B02 a list is newest first and pages on (created at, id) without repeating or skipping', async () => {
  const same = at(5);
  const rows = await Promise.all([
    capture(recorder, { createdAt: at(1) }),
    capture(recorder, { createdAt: same }),
    capture(recorder, { createdAt: same }),
    capture(recorder, { createdAt: at(9) }),
  ]);
  const expected = [...rows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
    .map((row) => row.id);
  const first = await repo.selectCaptures(db(), recorder, 2, null);
  const last = first.at(-1);
  if (!last) throw new Error('empty page');
  const second = await listed(recorder, 2, { createdAt: last.createdAt, id: last.id });
  expect([...first.map((row) => row.id), ...second]).toEqual(expected);
});
it('CAPTURES-B02 a single read finds a deleted capture (the access check refuses it), and nothing for an unknown id', async () => {
  const gone = await capture(recorder, { deletedAt: at(1) });
  expect((await repo.selectCapture(db(), gone.id))?.deletedAt).toEqual(at(1));
  expect(await repo.selectCapture(db(), id())).toBeUndefined();
  expect((await repo.selectCaptureAudio(db(), gone.id))?.mime).toBe('audio/webm');
});
it('CAPTURES-B02 the badge counts only the reader’s own live pending drafts and failed captures, admins included', async () => {
  const own = await capture(recorder);
  await suggestion(own.id);
  await suggestion(own.id);
  await suggestion(own.id, { status: 'approved' });
  await suggestion(own.id, { deletedAt: at(1) });
  const failedJob = id();
  await db()
    .insert(jobs)
    .values({ id: failedJob, kind: 'ai.captures.transcribe', payload: {}, status: 'failed' });
  await capture(recorder, { status: 'transcribing', transcribeJobId: failedJob });
  const deleted = await capture(recorder, { deletedAt: at(2), status: 'failed' });
  await suggestion(deleted.id);
  await suggestion((await capture(other)).id);
  expect(await repo.countPendingCaptures(db(), recorder)).toBe(3);
  expect(await repo.countPendingCaptures(db(), other)).toBe(1);
  expect(await repo.countPendingCaptures(db(), admin)).toBe(0);
});
it('CAPTURES-B02 suggestions are read per capture without the deleted ones, and deleting a capture deletes its drafts with it', async () => {
  const own = await capture(recorder);
  const kept = await suggestion(own.id);
  await suggestion(own.id, { deletedAt: at(1) });
  expect((await repo.selectSuggestions(db(), [own.id])).map((row) => row.id)).toEqual([kept.id]);
  expect(await repo.selectSuggestions(db(), [])).toEqual([]);
  const opId = id();
  await repo.softDeleteCapture(db(), own.id, recorder.id, opId);
  expect(await repo.selectSuggestions(db(), [own.id])).toEqual([]);
  expect((await repo.selectStoredCapture(db(), own.id))?.deletedOpId).toBe(opId);
  expect(await listed(recorder)).toEqual([]);
});
it('CAPTURES-B09 interpretation replaces only the drafts still pending', async () => {
  const own = await capture(recorder);
  await suggestion(own.id);
  const reviewed = await suggestion(own.id, { status: 'approved' });
  const fresh = id();
  await repo.replacePendingSuggestions(db(), own.id, id(), [
    { id: fresh, captureId: own.id, kind: 'task', payload: { title: 'Call back' } },
  ]);
  expect((await repo.selectSuggestions(db(), [own.id])).map((row) => row.id).sort()).toEqual(
    [reviewed.id, fresh].sort(),
  );
});
it('CAPTURES-B10 Approve all ready takes only the reader’s own live pending drafts, admins included', async () => {
  const own = await capture(recorder);
  const waiting = await suggestion(own.id);
  await suggestion(own.id, { status: 'discarded' });
  await suggestion(own.id, { deletedAt: at(1) });
  await suggestion((await capture(recorder, { deletedAt: at(2) })).id);
  await suggestion((await capture(other)).id);
  expect(await repo.selectOwnPendingSuggestions(db(), recorder)).toEqual([{ id: waiting.id }]);
  expect(await repo.selectOwnPendingSuggestions(db(), admin)).toEqual([]);
  expect((await repo.selectSuggestion(db(), waiting.id))?.createdBy).toBe(recorder.id);
});
