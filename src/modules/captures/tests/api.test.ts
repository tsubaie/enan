import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { voiceAudioLimits } from '@/core/files/voice-audio';
import type { User } from '@/core/http/user-schema';
import { notes } from '@/modules/notes/schema/db';
import * as api from '../api';
import { captures } from '../schema/db';
import { call, committee, record, suggestion, user, webm } from './fixtures';
// CAPTURES-B01 CAPTURES-B02 CAPTURES-B12: the capture routes as exported, with real multipart and
// JSON requests against the real database. The session is the one seam replaced; AI is off.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
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
  session.user = recorder;
});
const audio = (captureId: string, range?: string) =>
  api.audio(
    new Request(`http://local/api/v1/captures/${captureId}/audio`, {
      headers: range ? { Range: range } : {},
    }),
    { params: Promise.resolve({ id: captureId }) },
  );
async function recorded(seed = 1) {
  const created = await record(api.create, webm(seed), { durationSeconds: '12' });
  expect(created.status).toBe(201);
  return created.body.data as { id: string };
}
it('CAPTURES-B12 a disguised file, an oversized one and a recording over 15 minutes are refused, and nothing is stored', async () => {
  const page = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
  const disguised = await record(api.create, page);
  expect(disguised.status).toBe(422);
  expect(disguised.body.error.details).toMatchObject({ reason: 'unsupported_type' });
  const large = await record(api.create, webm(2, voiceAudioLimits.maxBytes + 1));
  expect([413, 422]).toContain(large.status);
  if (large.status === 422) expect(large.body.error.details).toMatchObject({ reason: 'too_large' });
  const long = await record(api.create, webm(3), { durationSeconds: '901' });
  expect(long.status).toBe(400);
  expect(await db().select().from(captures)).toEqual([]);
});
it('CAPTURES-B01 a recording started on a committee page carries the committee and creates no note', async () => {
  const board = await committee(admin, 'Projects Committee');
  const created = await record(api.create, webm(4), { committeeId: board.id });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({
    contextCommitteeId: board.id,
    status: 'needs_transcript',
  });
  expect(await db().select().from(notes)).toEqual([]);
  expect((await record(api.create, webm(5), { committeeId: id() })).status).toBe(404);
});
it('CAPTURES-B02 another member gets not_found on every capture path and never sees it in the list or count', async () => {
  const mine = await recorded(6);
  await suggestion(mine.id);
  session.user = other;
  const params = { id: mine.id };
  const paths = [
    await call(api.detail, 'GET', `/captures/${mine.id}`, params),
    await call(api.transcript, 'POST', `/captures/${mine.id}/transcript`, params, {
      transcript: 'Typed by someone else.',
    }),
    await call(api.transcribe, 'POST', `/captures/${mine.id}/transcribe`, params, {}),
    await call(api.interpret, 'POST', `/captures/${mine.id}/interpret`, params, {}),
    await call(api.remove, 'DELETE', `/captures/${mine.id}`, params),
  ];
  for (const answer of paths) {
    expect(answer.status).toBe(404);
    expect(answer.body.error).toMatchObject({
      code: 'not_found',
      details: { entityType: 'capture' },
    });
  }
  expect((await audio(mine.id)).status).toBe(404);
  expect((await call(api.list, 'GET', '/captures')).body.data).toEqual([]);
  expect((await call(api.count, 'GET', '/captures/count')).body.data).toEqual({ pending: 0 });
  // A missing id answers exactly the same.
  expect((await call(api.detail, 'GET', `/captures/${id()}`, { id: id() })).status).toBe(404);
  // The capture is untouched.
  session.user = recorder;
  expect((await call(api.detail, 'GET', `/captures/${mine.id}`, params)).status).toBe(200);
  expect((await call(api.count, 'GET', '/captures/count')).body.data).toEqual({ pending: 1 });
});
it('CAPTURES-B02 the recorder and an admin can open, play, list and delete it; signed out gets 401', async () => {
  const mine = await recorded(7);
  expect(
    (await call(api.list, 'GET', '/captures')).body.data.map((row: { id: string }) => row.id),
  ).toEqual([mine.id]);
  session.user = admin;
  expect((await call(api.detail, 'GET', `/captures/${mine.id}`, { id: mine.id })).status).toBe(200);
  expect((await audio(mine.id)).status).toBe(200);
  expect((await call(api.list, 'GET', '/captures')).body.data).toHaveLength(1);
  // The badge is the reader's own: an admin's does not count someone else's capture.
  expect((await call(api.count, 'GET', '/captures/count')).body.data).toEqual({ pending: 0 });
  session.user = null;
  expect((await audio(mine.id)).status).toBe(401);
  expect((await call(api.count, 'GET', '/captures/count')).status).toBe(401);
  session.user = recorder;
  expect((await call(api.remove, 'DELETE', `/captures/${mine.id}`, { id: mine.id })).status).toBe(
    204,
  );
  expect((await call(api.detail, 'GET', `/captures/${mine.id}`, { id: mine.id })).status).toBe(404);
  expect((await audio(mine.id)).status).toBe(404);
});
it('CAPTURES-B02 the audio answers in full, by range with 206 for seeking, and 416 outside it', async () => {
  const bytes = webm(8);
  const mine = await recorded(8);
  const full = await audio(mine.id);
  expect(full.headers.get('cache-control')).toBe('private, no-store');
  expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
  const part = await audio(mine.id, 'bytes=0-3');
  expect(part.status).toBe(206);
  expect(part.headers.get('content-range')).toBe(`bytes 0-3/${bytes.byteLength}`);
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.subarray(0, 4));
  expect((await audio(mine.id, `bytes=${bytes.byteLength + 10}-`)).status).toBe(416);
});
it('CAPTURES-B01 a typed transcript is kept on the capture, and interpreting without AI leaves it failed, not lost', async () => {
  const mine = await recorded(9);
  const typed = await call(
    api.transcript,
    'POST',
    `/captures/${mine.id}/transcript`,
    { id: mine.id },
    {
      transcript: 'Brief the board on Thursday.',
    },
  );
  expect(typed.status).toBe(200);
  expect(typed.body.data).toMatchObject({
    transcript: 'Brief the board on Thursday.',
    status: 'failed',
    errorCode: 'ai_unavailable',
  });
  const retried = await call(
    api.interpret,
    'POST',
    `/captures/${mine.id}/interpret`,
    { id: mine.id },
    {},
  );
  expect(retried.status).toBe(503);
  expect(await db().select().from(notes)).toEqual([]);
});
