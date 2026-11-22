import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import type { User } from '@/core/http/user-schema';
import { searchWorkspace } from '@/core/search/service';
import { listNotes } from '@/modules/notes';
import { NoteListQuery } from '@/modules/notes/schema/validation';
import * as api from '../api';
import { call, capture, committee, record, suggestion, user, webm } from './fixtures';
// CAPTURES-B02: member A records; member B, a missing id and a deleted capture all get the same
// `not_found` on every review route, lists and counts leave B out, and an admin may act.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
afterAll(() => closeDatabase());
let memberA: User;
let memberB: User;
let admin: User;
beforeEach(async () => {
  await clearDatabase();
  memberA = await user('Member A', 'member');
  memberB = await user('Member B', 'member');
  admin = await user('Administrator', 'admin');
});
const as = (reader: User) => {
  session.user = reader;
};
// Every route that reads or changes one draft, for one suggestion of one capture.
function routes(captureId: string, draftId: string, otherId: string) {
  const draft = { id: draftId };
  const path = (tail: string) => `/captures/suggestions/${draftId}${tail}`;
  return {
    get: () => call(api.detail, 'GET', `/captures/${captureId}`, { id: captureId }),
    audio: async () => ({
      status: (
        await api.audio(new Request(`http://local/api/v1/captures/${captureId}/audio`), {
          params: Promise.resolve({ id: captureId }),
        })
      ).status,
    }),
    patch: () =>
      call(api.patchSuggestion, 'PATCH', path(''), draft, { revision: 1, payload: { title: 'x' } }),
    approve: () => call(api.approve, 'POST', path('/approve'), draft, { revision: 1 }),
    approveReady: () =>
      call(api.approveReady, 'POST', '/captures/suggestions/approve-ready', {}, { ids: [draftId] }),
    discard: () => call(api.discard, 'POST', path('/discard'), draft, { revision: 1 }),
    undo: () => call(api.undo, 'POST', path('/undo'), draft, {}),
    undoBatch: () =>
      call(api.undoBatch, 'POST', '/captures/suggestions/undo', {}, { ids: [draftId] }),
    merge: () =>
      call(
        api.merge,
        'POST',
        `/captures/${captureId}/merge`,
        { id: captureId },
        {
          keepId: draftId,
          mergeIds: [otherId],
        },
      ),
  };
}
// Recorded through the route, so its audio is really stored and the audio route can answer.
async function draftOfA() {
  as(memberA);
  const created = await record(api.create, webm(1), { transcript: 'Send the quote.' });
  const recording = created.body.data as { id: string };
  const draft = await suggestion(recording.id);
  const other = await suggestion(recording.id, { payload: { title: 'Another' } });
  return { recording, draft, other };
}
it('CAPTURES-B02 another member gets not_found on every review route, and nothing changes', async () => {
  const { recording, draft, other } = await draftOfA();
  as(memberB);
  for (const [name, send] of Object.entries(routes(recording.id, draft.id, other.id))) {
    const answer = await send();
    expect([name, answer.status]).toEqual([name, 404]);
  }
  as(memberA);
  const mine = await call(api.detail, 'GET', `/captures/${recording.id}`, { id: recording.id });
  expect(mine.body.data.suggestions.map((item: { status: string }) => item.status)).toEqual([
    'pending',
    'pending',
  ]);
});
it('CAPTURES-B02 a missing id and a deleted capture answer exactly as another member does', async () => {
  const { recording, draft, other } = await draftOfA();
  as(memberA);
  const missing = routes(id(), id(), id());
  for (const send of Object.values(missing)) expect((await send()).status).toBe(404);
  await call(api.remove, 'DELETE', `/captures/${recording.id}`, { id: recording.id });
  for (const send of Object.values(routes(recording.id, draft.id, other.id)))
    expect((await send()).status).toBe(404);
  as(memberB);
  const answer = await routes(recording.id, draft.id, other.id).approve();
  expect(answer.body.error).toMatchObject({
    code: 'not_found',
    details: { entityType: 'capture' },
  });
});
it('CAPTURES-B02 the recorder and an admin may act on the draft; the admin reaches it through the all filter', async () => {
  const { recording, draft, other } = await draftOfA();
  as(admin);
  expect((await routes(recording.id, draft.id, other.id).get()).status).toBe(200);
  expect((await routes(recording.id, draft.id, other.id).audio()).status).toBe(200);
  expect((await routes(recording.id, draft.id, other.id).patch()).status).toBe(200);
  const mine = await call(api.list, 'GET', '/captures', {});
  expect(mine.body.data).toEqual([]);
  const everyone = await call(api.list, 'GET', '/captures?scope=all', {});
  expect(everyone.body.data.map((group: { id: string }) => group.id)).toEqual([recording.id]);
  // Decision 6: the badge is the reader's own work, admins included.
  expect((await call(api.count, 'GET', '/captures/count', {})).body.data.pending).toBe(0);
  as(memberA);
  // Two drafts, and the capture itself, failed: AI is off so its transcript was not interpreted.
  expect((await call(api.count, 'GET', '/captures/count', {})).body.data.pending).toBe(3);
  expect((await routes(recording.id, draft.id, other.id).approve()).status).toBe(409);
  expect((await call(api.approve, 'POST', '', { id: draft.id }, { revision: 2 })).status).toBe(200);
});
it('CAPTURES-B02 a member list and count hold only their own drafts, even asking for all', async () => {
  await draftOfA();
  as(memberB);
  expect((await call(api.list, 'GET', '/captures?scope=all', {})).body.data).toEqual([]);
  expect((await call(api.count, 'GET', '/captures/count', {})).body.data.pending).toBe(0);
});
it('CAPTURES-B02 drafts are not notes: absent from the notes list, workspace search and the committee tab', async () => {
  const board = await committee(admin, 'Projects Committee');
  const recording = await capture(memberA, { status: 'ready', contextCommitteeId: board.id });
  await suggestion(recording.id, {
    kind: 'committee_note',
    payload: {
      title: 'Quarterly warehouse review',
      committeeId: board.id,
      noteDate: '2026-11-22',
      body: 'Quarterly warehouse review',
    },
  });
  for (const reader of [memberA, admin]) {
    const ctx = { db: db(), user: reader, requestId: id() };
    const all = await listNotes(ctx, NoteListQuery.parse({}));
    const tab = await listNotes(ctx, NoteListQuery.parse({ committeeId: board.id }));
    expect([all.data, tab.data]).toEqual([[], []]);
    const found = await searchWorkspace(ctx, 'Quarterly warehouse');
    expect(found.hits.filter((hit) => hit.title.includes('warehouse'))).toEqual([]);
  }
});
