import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { jobs, notifications } from '@/core/db/system-schema';
import type { User } from '@/core/http/user-schema';
import { notes } from '@/modules/notes/schema/db';
import { tasks } from '@/modules/tasks/schema/db';
import { id } from '@/core/db/ids';
import { people } from '@/modules/people/schema/db';
import { patchCommittee, removeCommittee } from '@/modules/committees/service';
import * as api from '../api';
import { captureSuggestions } from '../schema/db';
import { call, capture, committee, person, suggestion, user } from './fixtures';
// CAPTURES-B03 CAPTURES-B04 CAPTURES-B10: Approve through the routes as exported, against the real
// database. The session is the one seam replaced.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
afterAll(() => closeDatabase());
let recorder: User;
let colleague: User;
beforeEach(async () => {
  await clearDatabase();
  recorder = await user('Recorder', 'member');
  colleague = await user('Colleague', 'member');
  session.user = recorder;
});
const patch = (suggestionId: string, body: object) =>
  call(
    api.patchSuggestion,
    'PATCH',
    `/captures/suggestions/${suggestionId}`,
    { id: suggestionId },
    body,
  );
const approve = (suggestionId: string, revision: number) =>
  call(
    api.approve,
    'POST',
    `/captures/suggestions/${suggestionId}/approve`,
    { id: suggestionId },
    { revision },
  );
const approveReady = (body: object = {}) =>
  call(api.approveReady, 'POST', '/captures/suggestions/approve-ready', {}, body);
const discard = (suggestionId: string, revision: number) =>
  call(
    api.discard,
    'POST',
    `/captures/suggestions/${suggestionId}/discard`,
    { id: suggestionId },
    { revision },
  );
const confident = { state: 'confident' as const, candidates: [] };
it('CAPTURES-B10 Approve creates the live task from the edited fields and records the pointer', async () => {
  const owner = await person('Finance Lead');
  const recording = await capture(recorder, { status: 'ready' });
  const draft = await suggestion(recording.id, {
    payload: { title: 'Send the quote', spokenOwner: 'the planning head', ownerId: null },
    fieldStates: { ownerId: { state: 'unknown', candidates: [] } },
  });
  const edited = await patch(draft.id, {
    revision: 1,
    payload: { title: 'Send the updated supplier quote', ownerId: owner.id, dueDate: '2026-11-26' },
  });
  expect(edited.status).toBe(200);
  expect(edited.body.data).toMatchObject({ revision: 2, fieldStates: { ownerId: confident } });
  expect(edited.body.data.payload).not.toHaveProperty('spokenOwner');
  const approved = await approve(draft.id, 2);
  expect(approved.status).toBe(200);
  const { live, suggestion: after } = approved.body.data;
  expect(live.type).toBe('task');
  const [task] = await db().select().from(tasks).where(eq(tasks.id, live.id));
  expect(task).toMatchObject({
    title: 'Send the updated supplier quote',
    ownerId: owner.id,
    dueDate: '2026-11-26',
    status: 'inbox',
    sourceNoteId: null,
    createdBy: recorder.id,
  });
  expect(after).toMatchObject({
    status: 'approved',
    liveEntityType: 'task',
    liveEntityId: live.id,
  });
  const [row] = await db()
    .select()
    .from(captureSuggestions)
    .where(eq(captureSuggestions.id, draft.id));
  expect(row).toMatchObject({ liveRevisionAtApprove: task?.revision, approvedBy: recorder.id });
  expect(row?.approvedAt).toBeInstanceOf(Date);
});
it('CAPTURES-B10 a committee note becomes an ordinary note with its committee, type, date and body', async () => {
  const board = await committee(recorder, 'Projects Committee');
  const recording = await capture(recorder, { status: 'ready' });
  const draft = await suggestion(recording.id, {
    kind: 'committee_note',
    payload: {
      title: 'Review the timeline',
      committeeId: null,
      noteDate: '2026-11-22',
      body: 'Review the project timeline before the board.',
    },
    fieldStates: { committeeId: { state: 'several', candidates: [board.id] } },
  });
  const blocked = await approve(draft.id, 1);
  expect(blocked.status).toBe(422);
  expect(blocked.body.error.details).toMatchObject({
    reason: 'unresolved',
    fields: ['committeeId'],
  });
  await patch(draft.id, { revision: 1, payload: { committeeId: board.id } });
  const approved = await approve(draft.id, 2);
  expect(approved.status).toBe(200);
  const [note] = await db().select().from(notes).where(eq(notes.id, approved.body.data.live.id));
  expect(note).toMatchObject({
    title: 'Review the timeline',
    committeeId: board.id,
    noteDate: '2026-11-22',
    content: 'Review the project timeline before the board.',
  });
});
it('CAPTURES-B03 nothing is notified before Approve; Approve fires task.assigned and note.mentioned only for others with a login', async () => {
  const theirs = await person('Colleague', colleague);
  const mine = await person('Recorder', recorder);
  const unlinked = await person('No Login');
  const recording = await capture(recorder, { status: 'ready' });
  const forThem = await suggestion(recording.id, {
    payload: { title: 'Their task', ownerId: theirs.id },
  });
  const forMe = await suggestion(recording.id, { payload: { title: 'My task', ownerId: mine.id } });
  const forNobody = await suggestion(recording.id, {
    payload: { title: 'Unlinked task', ownerId: unlinked.id },
  });
  const minutes = await suggestion(recording.id, {
    kind: 'meeting_note',
    payload: {
      title: 'Executive meeting',
      type: 'executive_meeting',
      noteDate: '2026-11-22',
      body: 'Postpone the warehouse.',
      participantIds: [theirs.id, mine.id],
    },
  });
  const dropped = await suggestion(recording.id, { payload: { title: 'Dropped' } });
  await patch(forThem.id, { revision: 1, payload: { title: 'Their task, edited' } });
  await discard(dropped.id, 1);
  expect(await db().select().from(notifications)).toEqual([]);
  for (const [draft, revision] of [
    [forThem, 2],
    [forMe, 1],
    [forNobody, 1],
    [minutes, 1],
  ] as const)
    expect((await approve(draft.id, revision)).status).toBe(200);
  const sent = await db().select().from(notifications);
  expect(sent.map((row) => [row.kind, row.userId, row.actorId]).sort()).toEqual([
    ['note.mentioned', colleague.id, recorder.id],
    ['task.assigned', colleague.id, recorder.id],
  ]);
});
it('CAPTURES-B04 Approve queues no refinement and no other job', async () => {
  const recording = await capture(recorder, { status: 'ready' });
  const draft = await suggestion(recording.id, {
    kind: 'meeting_note',
    payload: { title: 'Weekly', type: 'other', noteDate: '2026-11-22', body: 'Long body' },
  });
  expect((await approve(draft.id, 1)).status).toBe(200);
  expect(await db().select().from(jobs)).toEqual([]);
});
it('CAPTURES-B10 a second Approve of the same revision returns the first live record and creates no other', async () => {
  const recording = await capture(recorder, { status: 'ready' });
  const draft = await suggestion(recording.id);
  const first = await approve(draft.id, 1);
  const again = await approve(draft.id, 1);
  expect(again.status).toBe(200);
  expect(again.body.data.live).toEqual(first.body.data.live);
  expect(await db().select().from(tasks)).toHaveLength(1);
  expect((await approve(draft.id, 7)).status).toBe(409);
});
it('CAPTURES-B10 Approve N ready takes type-flagged drafts, skips an unresolved required committee, and refuses a listed one that is not ready', async () => {
  const recording = await capture(recorder, { status: 'ready' });
  const flagged = await suggestion(recording.id, {
    payload: { title: 'Looks like a note' },
    typeFlag: 'meeting_note',
  });
  const plain = await suggestion(recording.id, { payload: { title: 'Plain task' } });
  const unresolved = await suggestion(recording.id, {
    kind: 'committee_note',
    payload: { title: 'No committee', committeeId: null, noteDate: '2026-11-22', body: 'Body' },
    fieldStates: { committeeId: { state: 'unknown', candidates: [] } },
  });
  const listed = await approveReady({ ids: [plain.id, unresolved.id] });
  expect(listed.status).toBe(422);
  expect(listed.body.error.details).toMatchObject({ reason: 'not_ready', id: unresolved.id });
  expect(await db().select().from(tasks)).toEqual([]);
  // Someone else's ready draft is never part of the reader's "all ready".
  const theirs = await capture(colleague, { status: 'ready' });
  await suggestion(theirs.id, { payload: { title: 'Not mine' } });
  const all = await approveReady();
  expect(all.status).toBe(200);
  expect(
    all.body.data.approved.map((item: { suggestion: { id: string } }) => item.suggestion.id),
  ).toEqual([flagged.id, plain.id]);
  const rows = await db().select().from(captureSuggestions);
  expect(rows.find((row) => row.id === unresolved.id)?.status).toBe('pending');
  expect(await db().select().from(tasks)).toHaveLength(2);
});
it('CAPTURES-B10 an edit is checked against its kind, a stale revision conflicts, and the type chip reshapes the draft', async () => {
  const recording = await capture(recorder, { status: 'ready' });
  const draft = await suggestion(recording.id, {
    payload: { title: 'Plan', description: 'Discuss the plan' },
    typeFlag: 'meeting_note',
  });
  expect((await patch(draft.id, { revision: 1, payload: { dueDate: 'tomorrow' } })).status).toBe(
    400,
  );
  expect((await patch(draft.id, { revision: 1, payload: { body: 'x' } })).status).toBe(400);
  expect((await patch(draft.id, { revision: 3, payload: { title: 'x' } })).status).toBe(409);
  const changed = await patch(draft.id, { revision: 1, kind: 'meeting_note' });
  expect(changed.status).toBe(200);
  expect(changed.body.data).toMatchObject({
    kind: 'meeting_note',
    typeFlag: null,
    payload: { title: 'Plan', body: 'Discuss the plan', type: null, noteDate: null },
  });
  const blocked = await approve(draft.id, 2);
  expect(blocked.body.error.details).toMatchObject({ fields: ['type', 'noteDate'] });
});
it('CAPTURES-B10 a draft edited to a person who cannot be assigned, a missing, deleted or archived committee, or an unknown participant is refused at Approve and stays pending', async () => {
  const ctx = { db: db(), user: recorder, requestId: id() };
  const unassignable = await person('Former Staff', colleague);
  await db().update(people).set({ isAssignable: false }).where(eq(people.id, unassignable.id));
  const archived = await committee(recorder, 'Old Committee');
  await patchCommittee(ctx, archived.id, { revision: archived.revision, status: 'archived' });
  const deleted = await committee(recorder, 'Gone Committee');
  await removeCommittee(ctx, deleted.id, deleted.revision);
  const note = { title: 'Minutes', noteDate: '2026-11-22', body: 'Body' };
  const recording = await capture(recorder, { status: 'ready' });
  const cases = [
    ['task', { title: 'Owned', ownerId: null }, { ownerId: unassignable.id }],
    ['task', { title: 'Filed' }, { committeeId: id() }],
    ['committee_note', { ...note, committeeId: null }, { committeeId: archived.id }],
    ['committee_note', { ...note, committeeId: null }, { committeeId: deleted.id }],
    ['committee_note', { ...note, committeeId: null }, { committeeId: id() }],
    ['meeting_note', { ...note, type: 'other' }, { participantIds: [id()] }],
  ] as const;
  for (const [kind, payload, edit] of cases) {
    const draft = await suggestion(recording.id, { kind, payload });
    const edited = await patch(draft.id, { revision: 1, payload: edit });
    expect(edited.status, JSON.stringify(edit)).toBe(200);
    const refused = await approve(draft.id, 2);
    expect(refused.status, JSON.stringify(edit)).toBeGreaterThanOrEqual(400);
    expect(refused.status, JSON.stringify(edit)).toBeLessThan(500);
    const [row] = await db()
      .select()
      .from(captureSuggestions)
      .where(eq(captureSuggestions.id, draft.id));
    expect(row).toMatchObject({ status: 'pending', liveEntityId: null, approvedAt: null });
  }
  expect(await db().select().from(tasks)).toEqual([]);
  expect(await db().select().from(notes)).toEqual([]);
  expect(await db().select().from(notifications)).toEqual([]);
});
