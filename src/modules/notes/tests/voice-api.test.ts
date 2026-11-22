import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser } from '@/core/db/auth-repo';
import { auditLog, files } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
import { readStoredFile, storageUsage } from '@/core/files/storage';
import { User } from '@/core/http/user-schema';
import { resetConnection } from '@/core/ai/client';
import { latestAiJob } from '@/core/db/ai-jobs-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { notes, noteVoiceMemos } from '../schema/db';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
import * as api from '../api';
import { voiceNoteTitle } from '../voice/service';
import { insertVoiceMemo } from '../voice/repo';
import { upsertAudioFile } from '@/core/db/files-repo';
import { storeVoiceAudio } from '@/core/files/voice-audio';
// NOTES-B29–B32: the voice memo handlers as their routes export them, with real multipart and
// JSON requests against the real database and the test files directory. The session is the one
// seam replaced. AI is off unless a test turns it on, so every upload proves it needs none.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('@/core/ai/models', () => ({ loadModels: async () => [fixtureModel] }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
type Handler = (
  request: Request,
  route?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
const webm = (seed: number, size = 2048) => {
  const audio = new Uint8Array(size).map((_, index) => (index * 31 + seed) % 251);
  audio.set([0x1a, 0x45, 0xdf, 0xa3]);
  return audio;
};
const headers = (extra: Record<string, string> = {}) => ({
  Origin: env().APP_URL,
  'X-Requested-With': 'Enan',
  'Idempotency-Key': crypto.randomUUID(),
  ...extra,
});
const route = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
async function respond(handler: Handler, request: Request, params: Record<string, string>) {
  const response = await handler(request, route(params));
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
const upload = async (noteId: string, bytes: Uint8Array, fields: Record<string, string> = {}) =>
  respond(api.voiceUpload, await multipart(`/notes/${noteId}/voice`, bytes, fields), {
    id: noteId,
  });
// A memo as one recorded before the inbox (CAPTURES-B06): new audio can no longer reach a note
// through the API, so the row is written the way the retired upload wrote it.
async function existingMemo(
  noteId: string,
  bytes: Uint8Array,
  name = 'Board debrief.webm',
  transcript: string | null = null,
) {
  const audio = await storeVoiceAudio(new File([new Uint8Array(bytes)], name));
  const fileId = await upsertAudioFile(db(), {
    storageKey: audio.storageKey,
    originalName: audio.originalName,
    mime: audio.mime,
    sizeBytes: audio.sizeBytes,
    sha256: audio.sha256,
    uploadedBy: session.user?.id ?? null,
  });
  const memoId = id();
  await insertVoiceMemo(db(), {
    id: memoId,
    noteId,
    fileId,
    durationSeconds: 30,
    transcript,
    transcriptionStatus: transcript ? 'done' : 'skipped',
    createdBy: session.user?.id ?? null,
  });
  return { id: memoId, fileId };
}
const createFromVoice = async (bytes: Uint8Array, fields: Record<string, string> = {}) =>
  respond(api.voiceCreate, await multipart('/notes/voice', bytes, fields), {});
async function multipart(path: string, bytes: Uint8Array, fields: Record<string, string>) {
  const body = new FormData();
  body.set('file', new File([new Uint8Array(bytes)], 'Board debrief.webm', { type: 'text/html' }));
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const encoded = new Response(body);
  const raw = new Uint8Array(await encoded.arrayBuffer());
  return new Request(new URL(`/api/v1${path}`, env().APP_URL), {
    method: 'POST',
    headers: headers({
      'Content-Type': encoded.headers.get('content-type') ?? '',
      'Content-Length': String(raw.byteLength),
    }),
    body: raw,
  });
}
function json(
  handler: Handler,
  method: string,
  path: string,
  params: Record<string, string>,
  body = {},
) {
  const request = new Request(new URL(`/api/v1${path}`, env().APP_URL), {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  return respond(handler, request, params);
}
const createNote = async (fields: Record<string, string> = {}) =>
  (await json(api.create, 'POST', '/notes', {}, { title: 'Board debrief', ...fields })).body
    .data as {
    id: string;
    revision: number;
    content: string;
  };
const transcribe = (noteId: string, memoId: string, body: Record<string, string | boolean>) =>
  json(
    api.voiceTranscribe,
    'POST',
    `/notes/${noteId}/voice/${memoId}/transcribe`,
    { id: noteId, memoId },
    body,
  );
const audio = (noteId: string, memoId: string, range?: string) =>
  api.voiceAudioFile(
    new Request(new URL(`/api/v1/notes/${noteId}/voice/${memoId}/audio`, env().APP_URL), {
      headers: range ? { Range: range } : {},
    }),
    route({ id: noteId, memoId }),
  );
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  session.user = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Voice Tester',
      email: 'voice@example.test',
      passwordHash: 'unused-test-hash',
      role: 'member',
    }),
  );
});
afterAll(() => closeDatabase());
afterEach(() => resetConnection());
type Created = {
  id: string;
  title: string;
  content: string;
  committeeId: string | null;
  type: string | null;
  voiceMemos: { transcript: string | null; transcriptionStatus: string; durationSeconds: number }[];
};
it('CAPTURES-B07 both voice POST routes answer 410 gone, name their replacement and write nothing', async () => {
  const note = await createNote({ content: 'Existing prose' });
  const before = await storageUsage();
  // Random bytes: the key is the content's hash, so an earlier run cannot have stored this one.
  const bytes = crypto.getRandomValues(new Uint8Array(2048));
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  for (const answer of [
    await upload(note.id, bytes, { durationSeconds: '12' }),
    await createFromVoice(bytes, { durationSeconds: '12', transcript: 'Should not exist' }),
  ]) {
    expect(answer.status).toBe(410);
    expect(answer.body.error).toMatchObject({
      code: 'gone',
      details: { reason: 'retired', use: '/api/v1/captures' },
    });
  }
  expect(await db().select().from(noteVoiceMemos)).toEqual([]);
  expect(await db().select().from(notes)).toHaveLength(1);
  expect(await storageUsage()).toBe(before);
  const after = await json(api.detail, 'GET', `/notes/${note.id}`, { id: note.id });
  expect(after.body.data).toMatchObject({ content: 'Existing prose', revision: note.revision });
});
it('CAPTURES-B07 with the inbox rolled back, a recording becomes a note again, but attaching stays gone and no rewrite starts', async () => {
  globalThis.enanAiConnection = {
    state: 'enabled',
    checkedAt: new Date().toISOString(),
    error: null,
  };
  const actor = session.user?.id ?? '';
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, actor);
  await writeSetting(db(), 'captures.inbox', false, actor);
  const transcript = '## Ship the pilot on Sunday. Budget review follows.';
  const created = await createFromVoice(webm(21), { transcript, type: 'one_on_one' });
  expect(created.status).toBe(201);
  const note = created.body.data as Created;
  expect(note).toMatchObject({ title: 'Ship the pilot on Sunday', content: transcript });
  expect(note.voiceMemos[0]).toMatchObject({ transcript, transcriptionStatus: 'done' });
  expect(await latestAiJob(db(), actor, note.id, 'ai.notes.refine')).toBeUndefined();
  const attach = await upload(note.id, webm(22));
  expect(attach.status).toBe(410);
});
it('CAPTURES-B06 NOTES-B32 the audio answers in full, by range for seeking, 416 outside it, 401 signed out and 404 once gone', async () => {
  const note = await createNote();
  const bytes = webm(5);
  const memo = await existingMemo(note.id, bytes);
  const full = await audio(note.id, memo.id);
  expect(full.status).toBe(200);
  expect(full.headers.get('content-type')).toBe('audio/webm');
  expect(full.headers.get('accept-ranges')).toBe('bytes');
  expect(full.headers.get('x-content-type-options')).toBe('nosniff');
  expect(full.headers.get('content-disposition')).toBe(
    `inline; filename="Board debrief.webm"; filename*=UTF-8''Board%20debrief.webm`,
  );
  expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);
  const part = await audio(note.id, memo.id, 'bytes=100-199');
  expect(part.status).toBe(206);
  expect(part.headers.get('content-range')).toBe(`bytes 100-199/${bytes.byteLength}`);
  expect(part.headers.get('content-length')).toBe('100');
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.subarray(100, 200));
  const tail = await audio(note.id, memo.id, 'bytes=-48');
  expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.subarray(bytes.byteLength - 48));
  const outside = await audio(note.id, memo.id, `bytes=${bytes.byteLength}-`);
  expect(outside.status).toBe(416);
  expect(outside.headers.get('content-range')).toBe(`bytes */${bytes.byteLength}`);
  const user = session.user;
  session.user = null;
  expect((await audio(note.id, memo.id)).status).toBe(401);
  session.user = user;
  expect((await audio(note.id, id())).status).toBe(404);
  const removed = await json(api.voiceRemove, 'DELETE', `/notes/${note.id}/voice/${memo.id}`, {
    id: note.id,
    memoId: memo.id,
  });
  expect(removed.status).toBe(200);
  expect(removed.body.data.voiceMemos).toEqual([]);
  expect((await audio(note.id, memo.id)).status).toBe(404);
});
it('CAPTURES-B06 NOTES-B30 removing a memo soft-deletes it, keeps the binary and is audited', async () => {
  const note = await createNote();
  const memo = await existingMemo(note.id, webm(6));
  await json(api.voiceRemove, 'DELETE', `/notes/${note.id}/voice/${memo.id}`, {
    id: note.id,
    memoId: memo.id,
  });
  const [row] = await db().select().from(noteVoiceMemos).where(eq(noteVoiceMemos.id, memo.id));
  expect(row?.deletedAt).toBeInstanceOf(Date);
  expect(row?.deletedOpId).toBeTruthy();
  const [file] = await db().select().from(files).where(eq(files.id, memo.fileId));
  await expect(readStoredFile(file?.storageKey ?? '')).resolves.toBeTruthy();
  const audits = await db().select().from(auditLog).where(eq(auditLog.entityId, memo.id));
  expect(audits.map((entry) => entry.action)).toEqual(['delete']);
  const again = await json(api.voiceRemove, 'DELETE', `/notes/${note.id}/voice/${memo.id}`, {
    id: note.id,
    memoId: memo.id,
  });
  expect(again.status).toBe(404);
});
it('CAPTURES-B06 NOTES-B31 a transcript is stored on the memo and reaches the note only when appendToNote asks', async () => {
  const note = await createNote({ content: 'Opening remarks' });
  const memo = await existingMemo(note.id, webm(7));
  const saved = await transcribe(note.id, memo.id, { transcript: 'Hire two analysts.' });
  expect(saved.status).toBe(200);
  expect(saved.body.data.voiceMemos[0]).toMatchObject({
    transcript: 'Hire two analysts.',
    transcriptionStatus: 'done',
  });
  expect(saved.body.data.content).toBe('Opening remarks');
  expect(saved.body.data.revision).toBe(note.revision);
  const appended = await transcribe(note.id, memo.id, { appendToNote: true });
  expect(appended.status).toBe(200);
  expect(appended.body.data.content).toBe('Opening remarks\n\nHire two analysts.');
  expect(appended.body.data.revision).toBe(note.revision + 1);
});
it('CAPTURES-B06 NOTES-B31 appending or refining needs a transcript, and a refused refine leaves the note as it was', async () => {
  const note = await createNote({ content: 'Opening remarks' });
  const memo = await existingMemo(note.id, webm(8));
  const empty = await transcribe(note.id, memo.id, { appendToNote: true });
  expect(empty.status).toBe(422);
  expect(empty.body.error.details).toMatchObject({ reason: 'no_transcript' });
  await transcribe(note.id, memo.id, { transcript: 'Call the auditors.' });
  const refused = await transcribe(note.id, memo.id, { appendToNote: true, refine: true });
  expect(refused.status).toBe(503);
  expect(refused.body.error.code).toBe('ai_unavailable');
  const after = await json(api.detail, 'GET', `/notes/${note.id}`, { id: note.id });
  expect(after.body.data.content).toBe('Opening remarks');
});
it('CAPTURES-B06 NOTES-B32 an Arabic file name is served, its header carrying an ASCII stand-in and the name itself', async () => {
  const note = await createNote();
  const memo = await existingMemo(note.id, webm(9), 'مذكرة صوتية.webm');
  const served = await audio(note.id, memo.id);
  expect(served.status).toBe(200);
  expect(served.headers.get('content-disposition')).toBe(
    `inline; filename="_____ _____.webm"; filename*=UTF-8''${encodeURIComponent('مذكرة صوتية.webm')}`,
  );
});

it('NOTES-B36 a title is the first sentence without heading marks, cut at a word to 120', () => {
  expect(voiceNoteTitle(undefined, '2026-10-27')).toBe('Voice Memo 2026-10-27');
  expect(voiceNoteTitle('\n\n- Quarterly risks? Then more', 'x')).toBe('Quarterly risks?');
  const long = voiceNoteTitle('word '.repeat(60), 'x');
  expect(long.length).toBeLessThanOrEqual(120);
  expect(long.endsWith('word…')).toBe(true);
});
