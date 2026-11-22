import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import type { User } from '@/core/http/user-schema';
import { patchTask } from '@/modules/tasks/service';
import { notes } from '@/modules/notes/schema/db';
import { tasks } from '@/modules/tasks/schema/db';
import * as api from '../api';
import { captureSuggestions } from '../schema/db';
import { call, capture, suggestion, user } from './fixtures';
// CAPTURES-B11: Undo is decided by the server, from the live record and the clock.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
afterAll(() => closeDatabase());
let recorder: User;
beforeEach(async () => {
  await clearDatabase();
  recorder = await user('Recorder', 'member');
  session.user = recorder;
});
const approve = (suggestionId: string, revision = 1) =>
  call(
    api.approve,
    'POST',
    `/captures/suggestions/${suggestionId}/approve`,
    { id: suggestionId },
    { revision },
  );
const undo = (suggestionId: string) =>
  call(api.undo, 'POST', `/captures/suggestions/${suggestionId}/undo`, { id: suggestionId }, {});
const undoBatch = (ids: string[]) =>
  call(api.undoBatch, 'POST', '/captures/suggestions/undo', {}, { ids });
const row = async (suggestionId: string) =>
  (await db().select().from(captureSuggestions).where(eq(captureSuggestions.id, suggestionId)))[0];
const age = (suggestionId: string, ms: number) =>
  db()
    .update(captureSuggestions)
    .set({ approvedAt: new Date(Date.now() - ms) })
    .where(eq(captureSuggestions.id, suggestionId));
async function approvedTask(title = 'Send the quote') {
  const recording = await capture(recorder, { status: 'ready' });
  const draft = await suggestion(recording.id, { payload: { title } });
  const approved = await approve(draft.id);
  expect(approved.status).toBe(200);
  return { draft, liveId: approved.body.data.live.id as string };
}
it('CAPTURES-B11 an unedited approval undone within 60 s soft-deletes the live record and the draft is pending again', async () => {
  const { draft, liveId } = await approvedTask();
  await age(draft.id, 50_000);
  const undone = await undo(draft.id);
  expect(undone.status).toBe(200);
  expect(undone.body.data).toMatchObject({
    status: 'pending',
    liveEntityId: null,
    liveEntityType: null,
    revision: 2,
  });
  const [task] = await db().select().from(tasks).where(eq(tasks.id, liveId));
  expect(task?.deletedAt).toBeInstanceOf(Date);
  expect(task?.deletedOpId).toBeTruthy();
  expect(await row(draft.id)).toMatchObject({ approvedAt: null, liveRevisionAtApprove: null });
  // Approving again makes a new record from the draft.
  const again = await approve(draft.id, 2);
  expect(again.body.data.live.id).not.toBe(liveId);
});
it('CAPTURES-B11 an approval whose live record was edited cannot be undone and the record stays', async () => {
  const { draft, liveId } = await approvedTask();
  const [task] = await db().select().from(tasks).where(eq(tasks.id, liveId));
  await patchTask({ db: db(), user: recorder, requestId: id() }, liveId, {
    title: 'Edited after approve',
    revision: task?.revision ?? 1,
  });
  const refused = await undo(draft.id);
  expect(refused.status).toBe(422);
  expect(refused.body.error).toMatchObject({
    code: 'rule_violation',
    details: { reason: 'undo_unavailable' },
  });
  const [kept] = await db().select().from(tasks).where(eq(tasks.id, liveId));
  expect(kept?.deletedAt).toBeNull();
  expect((await row(draft.id))?.status).toBe('approved');
});
it('CAPTURES-B11 after 60 s an unedited approval can no longer be undone', async () => {
  const { draft, liveId } = await approvedTask();
  await age(draft.id, 61_000);
  const refused = await undo(draft.id);
  expect(refused.status).toBe(422);
  expect(refused.body.error.details).toMatchObject({ reason: 'undo_unavailable' });
  const [kept] = await db().select().from(tasks).where(eq(tasks.id, liveId));
  expect(kept?.deletedAt).toBeNull();
});
it('CAPTURES-B11 a batch undo is all or nothing: one edited member keeps every record', async () => {
  const recording = await capture(recorder, { status: 'ready' });
  const first = await suggestion(recording.id, { payload: { title: 'First' } });
  const second = await suggestion(recording.id, {
    kind: 'meeting_note',
    payload: { title: 'Minutes', type: 'other', noteDate: '2026-11-22', body: 'Body' },
  });
  const batch = await call(
    api.approveReady,
    'POST',
    '/captures/suggestions/approve-ready',
    {},
    { ids: [first.id, second.id] },
  );
  expect(batch.status).toBe(200);
  const [, note] = batch.body.data.approved;
  await db().update(notes).set({ revision: 5 }).where(eq(notes.id, note.live.id));
  const refused = await undoBatch([first.id, second.id]);
  expect(refused.status).toBe(422);
  expect((await db().select().from(tasks))[0]?.deletedAt).toBeNull();
  expect((await row(first.id))?.status).toBe('approved');
  // With nothing edited, the whole batch goes back.
  await db().update(notes).set({ revision: 1 }).where(eq(notes.id, note.live.id));
  const undone = await undoBatch([first.id, second.id]);
  expect(undone.status).toBe(200);
  expect(undone.body.data.map((item: { status: string }) => item.status)).toEqual([
    'pending',
    'pending',
  ]);
  expect((await db().select().from(notes))[0]?.deletedAt).toBeInstanceOf(Date);
});
it('CAPTURES-B11 undoing a discard restores the draft to pending, with no record made', async () => {
  const recording = await capture(recorder, { status: 'ready' });
  const draft = await suggestion(recording.id);
  const discarded = await call(
    api.discard,
    'POST',
    `/captures/suggestions/${draft.id}/discard`,
    { id: draft.id },
    { revision: 1 },
  );
  expect(discarded.body.data.status).toBe('discarded');
  const undone = await undo(draft.id);
  expect(undone.body.data).toMatchObject({ status: 'pending', revision: 2 });
  expect(await db().select().from(tasks)).toEqual([]);
});
