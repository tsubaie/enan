import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import type { User } from '@/core/http/user-schema';
import * as api from '../api';
import { captureSuggestions } from '../schema/db';
import { call, capture, suggestion, user } from './fixtures';
// S24, §9 decision 9: drafts of one recording merge only within one kind.
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
const merge = (captureId: string, keepId: string, mergeIds: string[]) =>
  call(api.merge, 'POST', `/captures/${captureId}/merge`, { id: captureId }, { keepId, mergeIds });
it('CAPTURES-B10 merging drafts of one kind keeps the chosen one, with the others merged into it', async () => {
  const recording = await capture(recorder, { status: 'ready', transcript: 'One. Two.' });
  const kept = await suggestion(recording.id, { sourceSpans: [{ start: 0, end: 4 }] });
  const other = await suggestion(recording.id, {
    payload: { title: 'Again' },
    sourceSpans: [{ start: 5, end: 9 }],
  });
  const merged = await merge(recording.id, kept.id, [other.id]);
  expect(merged.status).toBe(200);
  expect(merged.body.data).toMatchObject({
    id: kept.id,
    status: 'pending',
    revision: 2,
    sourceSpans: [
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ],
  });
  const rows = await db().select().from(captureSuggestions);
  expect(rows.find((row) => row.id === other.id)).toMatchObject({
    status: 'merged',
    mergeTargetId: kept.id,
  });
});
it('CAPTURES-B10 merging across kinds or across recordings is refused and changes nothing', async () => {
  const recording = await capture(recorder, { status: 'ready' });
  const task = await suggestion(recording.id);
  const note = await suggestion(recording.id, {
    kind: 'meeting_note',
    payload: { title: 'Minutes', type: 'other', noteDate: '2026-11-22', body: 'Body' },
  });
  const crossKind = await merge(recording.id, task.id, [note.id]);
  expect(crossKind.status).toBe(422);
  expect(crossKind.body.error.details).toMatchObject({ reason: 'kind' });
  const elsewhere = await capture(recorder, { status: 'ready' });
  const stranger = await suggestion(elsewhere.id);
  expect((await merge(recording.id, task.id, [stranger.id])).status).toBe(404);
  const rows = await db().select().from(captureSuggestions);
  expect(rows.every((row) => row.status === 'pending')).toBe(true);
});
