import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { and, eq } from 'drizzle-orm';
import { id } from '@/core/db/ids';
import { auditLog, files } from '@/core/db/system-schema';
import { writeSetting } from '@/core/db/settings-repo';
import { storageUsage } from '@/core/files/storage';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { voiceAudioLimits } from '@/core/files/voice-audio';
import type { User } from '@/core/http/user-schema';
import { notes } from '@/modules/notes/schema/db';
import * as api from '../api';
import { captureSuggestions, captures } from '../schema/db';
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
  // An admin's own inbox holds their own recordings; everyone's is the `all` filter.
  expect((await call(api.list, 'GET', '/captures')).body.data).toHaveLength(0);
  expect((await call(api.list, 'GET', '/captures?scope=all')).body.data).toHaveLength(1);
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

const stored = async (captureId: string) =>
  (await db().select().from(captures).where(eq(captures.id, captureId)))[0];
const remove = (captureId: string) =>
  call(api.remove, 'DELETE', `/captures/${captureId}`, { id: captureId });
const restore = (captureId: string, opId: string) =>
  call(api.restore, 'POST', `/captures/${captureId}/restore`, { id: captureId }, { opId });
const notFound = { code: 'not_found', details: { entityType: 'capture' } };
it('CAPTURES-B02 a repeat delete by the recorder answers 204 with the first operation id and rewrites nothing', async () => {
  const mine = await recorded(20);
  const first = await remove(mine.id);
  expect(first.status).toBe(204);
  const opId = first.response.headers.get('X-Op-Id');
  expect(opId).toBeTruthy();
  const before = await stored(mine.id);
  const again = await remove(mine.id);
  expect(again.status).toBe(204);
  expect(again.response.headers.get('X-Op-Id')).toBe(opId);
  expect(await stored(mine.id)).toEqual(before);
  const deletes = await db()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, mine.id), eq(auditLog.action, 'delete')));
  expect(deletes).toHaveLength(1);
  // Another member still learns nothing, before or after the delete.
  session.user = other;
  expect((await remove(mine.id)).body.error).toMatchObject(notFound);
  expect((await remove(id())).body.error).toMatchObject(notFound);
});
it("CAPTURES-B02 an admin deletes someone else's capture; another member gets 404 and the row is untouched", async () => {
  const mine = await recorded(21);
  session.user = other;
  const denied = await remove(mine.id);
  expect(denied.status).toBe(404);
  expect(denied.body.error).toMatchObject(notFound);
  expect((await stored(mine.id))?.deletedAt).toBeNull();
  session.user = admin;
  expect((await remove(mine.id)).status).toBe(204);
  expect((await stored(mine.id))?.deletedAt).not.toBeNull();
});
it("CAPTURES-B13 restore with the delete's op id brings back the capture and its drafts, audited; a wrong id or another member gets 404", async () => {
  const mine = await recorded(22);
  const draft = await suggestion(mine.id);
  const opId = (await remove(mine.id)).response.headers.get('X-Op-Id') ?? '';
  const wrong = await restore(mine.id, id());
  expect(wrong.status).toBe(404);
  expect(wrong.body.error).toMatchObject(notFound);
  session.user = other;
  const denied = await restore(mine.id, opId);
  expect(denied.status).toBe(404);
  expect(denied.body.error).toMatchObject(notFound);
  expect((await restore(id(), opId)).status).toBe(404);
  expect((await stored(mine.id))?.deletedAt).not.toBeNull();
  session.user = recorder;
  const back = await restore(mine.id, opId);
  expect(back.status).toBe(200);
  expect(back.body.data).toMatchObject({ id: mine.id, suggestions: [{ id: draft.id }] });
  const [row] = await db()
    .select()
    .from(captureSuggestions)
    .where(eq(captureSuggestions.id, draft.id));
  expect(row).toMatchObject({ deletedAt: null, deletedOpId: null });
  expect((await call(api.detail, 'GET', `/captures/${mine.id}`, { id: mine.id })).status).toBe(200);
  const restores = await db()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, mine.id), eq(auditLog.action, 'restore')));
  expect(restores).toHaveLength(1);
  // A repeat of that restore answers the capture and writes nothing; another op id is not found.
  const repeat = await restore(mine.id, opId);
  expect(repeat.status).toBe(200);
  expect(repeat.body.data).toMatchObject({ id: mine.id });
  expect(
    await db()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, mine.id), eq(auditLog.action, 'restore'))),
  ).toHaveLength(1);
  expect((await restore(mine.id, id())).status).toBe(404);
});
// CAPTURES-B14: with recording off, for the workspace or for the reader, new audio is refused
// before its body is read; everything done to a recording that already exists still works.
it.each([
  ['workspace', 'captures.enabled'],
  ['account', 'user.captures.enabled'],
] as const)(
  'CAPTURES-B14 with recording off (%s) POST /captures answers 403 recording_off before the body is parsed and stores nothing',
  async (scope, key) => {
    const before = await storageUsage();
    if (key === 'captures.enabled') await writeSetting(db(), key, false, admin.id);
    else await writeSetting(db(), key, false, recorder.id, recorder.id);
    // An invalid duration would be a 400 and a disguised file a 422: neither is reached.
    for (const answer of [
      await record(api.create, webm(41), { durationSeconds: 'many' }),
      await record(api.create, new TextEncoder().encode('<!doctype html>')),
      await record(api.create, webm(42), { durationSeconds: '12' }),
    ]) {
      expect(answer.status).toBe(403);
      expect(answer.body.error).toMatchObject({
        code: 'forbidden',
        details: { reason: 'recording_off', scope },
      });
    }
    expect(await db().select().from(captures)).toEqual([]);
    expect(await db().select().from(files)).toEqual([]);
    expect(await storageUsage()).toBe(before);
    // The other member is untouched by one reader's own switch.
    session.user = other;
    const elsewhere = await record(api.create, webm(43), { durationSeconds: '12' });
    expect(elsewhere.status).toBe(scope === 'account' ? 201 : 403);
  },
);
it.each([
  ['workspace', 'captures.enabled'],
  ['account', 'user.captures.enabled'],
] as const)(
  'CAPTURES-B14 recording turned off (%s) while the body is arriving refuses POST /captures with 403 recording_off and stores no row and no file',
  async (scope, key) => {
    // The switch goes off while the body streams in, so the check made once it has arrived, before
    // anything is written, refuses it: no file on disk either. (Only a switch turned off after that
    // check and before the in-transaction one could leave an unreferenced file, for #186.)
    const before = await storageUsage();
    const off = async () => {
      if (key === 'captures.enabled') await writeSetting(db(), key, false, admin.id);
      else await writeSetting(db(), key, false, recorder.id, recorder.id);
    };
    const answer = await record(api.create, unique(webm(45)), { durationSeconds: '12' }, off);
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatchObject({
      code: 'forbidden',
      details: { reason: 'recording_off', scope },
    });
    expect(await db().select().from(captures)).toEqual([]);
    expect(await db().select().from(files)).toEqual([]);
    expect(await storageUsage()).toBe(before);
  },
);
it('CAPTURES-B14 with recording off an existing recording can still be listed, opened, played, typed, retried, deleted and restored', async () => {
  const mine = await recorded(44);
  await writeSetting(db(), 'captures.enabled', false, admin.id);
  const params = { id: mine.id };
  expect((await call(api.list, 'GET', '/captures')).status).toBe(200);
  expect((await call(api.count, 'GET', '/captures/count')).status).toBe(200);
  expect((await call(api.detail, 'GET', `/captures/${mine.id}`, params)).status).toBe(200);
  expect((await audio(mine.id)).status).toBe(200);
  const typed = await call(api.transcript, 'POST', `/captures/${mine.id}/transcript`, params, {
    transcript: 'Typed while recording is off.',
  });
  expect(typed.status).toBe(200);
  // AI is off in this suite, so Retry answers as it does with recording on (503), never 403.
  for (const retried of [
    await call(api.interpret, 'POST', `/captures/${mine.id}/interpret`, params, {}),
    await call(api.transcribe, 'POST', `/captures/${mine.id}/transcribe`, params, {}),
  ])
    expect(retried.status).toBe(503);
  const removed = await call(api.remove, 'DELETE', `/captures/${mine.id}`, params);
  expect(removed.status).toBe(204);
  const opId = removed.response.headers.get('X-Op-Id') ?? '';
  const restored = await call(api.restore, 'POST', `/captures/${mine.id}/restore`, params, {
    opId,
  });
  expect(restored.status).toBe(200);
});
// Bytes no earlier run stored: files are content-addressed and FILES_DIR outlives a run, so a
// repeated upload would find its file already there and "nothing written" would prove nothing.
function unique(bytes: Uint8Array) {
  crypto.getRandomValues(bytes.subarray(bytes.length - 16));
  return bytes;
}
