import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { claim, enqueue, fail } from '@/core/db/jobs-repo';
import { migrateDatabase } from '@/core/db/migrate';
import { markRead } from '@/core/db/notifications-repo';
import { clearDatabase } from '@/core/db/reset';
import { notifications } from '@/core/db/system-schema';
import { z } from 'zod';
import type { User } from '@/core/http/user-schema';
import { feed } from '@/modules/notifications/service';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
import { captureJobs } from '../jobs';
import { notifyReady, resolve } from '../notifications';
import { captureSuggestions, captures } from '../schema/db';
import { capture, queuedJob, suggestion, user } from './fixtures';
// CAPTURES-B21 (ADR 0073): the recorder's grouped ready line and a failed recording's line, against
// the real database, the runner's fail transaction and the bell's feed.
beforeAll(() => migrateDatabase());
afterAll(() => closeDatabase());
let recorder: User;
let other: User;
let admin: User;
beforeEach(async () => {
  await clearDatabase();
  recorder = await user('Recorder', 'member');
  other = await user('Other Member', 'member');
  admin = await user('Administrator', 'admin');
});
const ctx = (reader: User) => ({ db: db(), user: reader, requestId: id() });
const lines = (reader: User) => feed(ctx(reader), 20, null);
const rows = () => db().select().from(notifications);
async function readyRecording(reader = recorder) {
  const row = await capture(reader, { status: 'ready' });
  await suggestion(row.id);
  await withTransaction(db(), (database) => notifyReady(database, row));
  return row;
}
it('CAPTURES-B21 three ready recordings are one unread line whose number is counted when the bell is read', async () => {
  const [first, second, third] = [
    await readyRecording(),
    await readyRecording(),
    await readyRecording(),
  ];
  const stored = await rows();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    userId: recorder.id,
    kind: 'captures.ready',
    subjectType: 'captures',
    subjectId: recorder.id,
    actorId: null,
    payload: {},
  });
  expect((await lines(recorder)).items[0]).toMatchObject({ count: 3, href: '/captures' });
  // Approving every draft of one leaves two; discarding another leaves one; deleting the last
  // drops the line without a write.
  await db()
    .update(captureSuggestions)
    .set({ status: 'approved' })
    .where(eq(captureSuggestions.captureId, first.id));
  expect((await lines(recorder)).items[0]?.count).toBe(2);
  await db()
    .update(captureSuggestions)
    .set({ status: 'discarded' })
    .where(eq(captureSuggestions.captureId, second.id));
  expect((await lines(recorder)).items[0]?.count).toBe(1);
  await db().update(captures).set({ deletedAt: new Date() }).where(eq(captures.id, third.id));
  const empty = await lines(recorder);
  expect(empty.items).toEqual([]);
  expect(empty.unread).toBe(0);
  // Restored, it is back; once read, the next ready recording opens a new line.
  await db().update(captures).set({ deletedAt: null }).where(eq(captures.id, third.id));
  const [line] = (await lines(recorder)).items;
  expect(line?.count).toBe(1);
  await markRead(db(), recorder.id, line?.id ?? '');
  await readyRecording();
  expect(await rows()).toHaveLength(2);
});
it('CAPTURES-B21 nobody but the recorder resolves their batch, an administrator included', async () => {
  await readyRecording();
  expect(await resolve(ctx(admin), [recorder.id])).toEqual(new Map());
  expect(await resolve(ctx(other), [recorder.id])).toEqual(new Map());
  // An administrator's own line counts only their own recordings, never everyone's.
  await withTransaction(db(), (database) =>
    notifyReady(database, { id: id(), createdBy: admin.id }),
  );
  expect((await lines(admin)).items).toEqual([]);
  expect((await lines(other)).items).toEqual([]);
});
const payload = (captureId: string) =>
  z.json().parse({
    capability: 'notes.transcribe',
    entityId: captureId,
    revision: 1,
    input: { captureId },
    model: JSON.parse(JSON.stringify(fixtureModel)),
    locale: 'en',
    capabilityVersion: 1,
    promptVersion: 1,
    contentHash: 'fixture',
    maxOutputTokens: 4096,
    reservedTokens: 10000,
  });
// A recording transcribing on a job the runner has claimed, failed the way the runner fails it.
async function failing(
  retry: boolean,
  change: (row: { id: string }) => Promise<void> = async () => {},
) {
  const row = await capture(recorder, { status: 'transcribing' });
  const kind = 'ai.captures.transcribe';
  const job = await withTransaction(db(), (database) =>
    enqueue(database, kind, payload(row.id), null, recorder.id),
  );
  await db().update(captures).set({ transcribeJobId: job.id }).where(eq(captures.id, row.id));
  const claimed = await claim('test', kind, 2, 10);
  if (!claimed) throw new Error('nothing claimed');
  await change(row);
  const hook = captureJobs[kind]?.finished;
  if (!hook) throw new Error('no finished hook');
  await fail(claimed, 'provider', retry, undefined, (database) =>
    hook(database, claimed, 'failed'),
  );
  return row;
}
it('CAPTURES-B21 a job that fails for good tells the recorder once, and the line opens that recording', async () => {
  const row = await failing(false);
  const stored = await rows();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    userId: recorder.id,
    kind: 'captures.failed',
    subjectId: row.id,
    actorId: null,
    payload: {},
  });
  const [line] = (await lines(recorder)).items;
  expect(line).toMatchObject({ kind: 'captures.failed', href: `/captures?capture=${row.id}` });
  expect(line?.title).toBe(row.createdAt.toISOString());
  // Visible to an administrator by the capture rule, but never addressed to one.
  expect((await lines(admin)).items).toEqual([]);
  // Retried, it no longer reads as failed and the line drops.
  await db().update(captures).set({ status: 'queued' }).where(eq(captures.id, row.id));
  expect((await lines(recorder)).items).toEqual([]);
});
it('CAPTURES-B21 a failure that will be retried, a deleted recording and one waiting on another job tell nobody', async () => {
  await failing(true);
  await failing(false, async (row) => {
    await db().update(captures).set({ deletedAt: new Date() }).where(eq(captures.id, row.id));
  });
  await failing(false, async (row) => {
    const jobId = await queuedJob();
    await db().update(captures).set({ transcribeJobId: jobId }).where(eq(captures.id, row.id));
  });
  expect(await rows()).toEqual([]);
});
