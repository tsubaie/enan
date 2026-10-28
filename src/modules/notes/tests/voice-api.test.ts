import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser } from '@/core/db/auth-repo';
import { auditLog, files } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
import { readStoredFile } from '@/core/files/storage';
import { User } from '@/core/http/user-schema';
import { resetConnection } from '@/core/ai/client';
import { latestAiJob } from '@/core/db/ai-jobs-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { notes, noteVoiceMemos } from '../schema/db';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
import * as api from '../api';
import { voiceNoteTitle } from '../voice/service';
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
async function upload(noteId: string, bytes: Uint8Array, fields: Record<string, string> = {}) {
  return respond(api.voiceUpload, await multipart(`/notes/${noteId}/voice`, bytes, fields), {
    id: noteId,
  });
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
it('NOTES-B29 NOTES-I08 an upload stores the audio by its hash and answers 201 with the memo, AI or not', async () => {
  const note = await createNote({ content: 'Existing prose' });
  const bytes = webm(1);
  const created = await upload(note.id, bytes, { durationSeconds: '74' });
  expect(created.status).toBe(201);
  const [memo] = created.body.data.voiceMemos;
  expect(memo).toMatchObject({
    originalName: 'Board debrief.webm',
    mime: 'audio/webm',
    sizeBytes: bytes.byteLength,
    durationSeconds: 74,
    transcript: null,
    transcriptionStatus: 'skipped',
    audioUrl: `/api/v1/notes/${note.id}/voice/${memo.id}/audio`,
  });
  expect(created.body.data.content).toBe('Existing prose');
  const [file] = await db().select().from(files).where(eq(files.id, memo.fileId));
  expect(file?.storageKey).toBe(`voice-${file?.sha256}`);
  expect(new Uint8Array(await readStoredFile(file?.storageKey ?? ''))).toEqual(bytes);
  const audits = await db().select().from(auditLog).where(eq(auditLog.entityId, memo.id));
  expect(audits.map((row) => [row.action, row.entityType])).toEqual([
    ['create', 'note_voice_memo'],
  ]);
  // The same recording again is a second memo over the one stored file.
  const again = await upload(note.id, bytes);
  expect(again.body.data.voiceMemos.map((item: { fileId: string }) => item.fileId)).toEqual([
    memo.fileId,
    memo.fileId,
  ]);
});
it('NOTES-B29 a transcript sent with the audio marks the memo done without touching the note', async () => {
  const note = await createNote({ content: 'Keep me' });
  const created = await upload(note.id, webm(2), { transcript: 'We agreed to ship on Sunday.' });
  expect(created.body.data.voiceMemos[0]).toMatchObject({
    transcript: 'We agreed to ship on Sunday.',
    transcriptionStatus: 'done',
  });
  expect(created.body.data.content).toBe('Keep me');
  expect(created.body.data.revision).toBe(note.revision);
});
it('NOTES-B29 a disguised file, an unknown note and a deleted note are refused', async () => {
  const note = await createNote();
  const page = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
  const refused = await upload(note.id, page);
  expect(refused.status).toBe(422);
  expect(refused.body.error.details).toMatchObject({ reason: 'unsupported_type' });
  expect((await upload(id(), webm(3))).status).toBe(404);
  await json(
    api.remove,
    'DELETE',
    `/notes/${note.id}`,
    { id: note.id },
    { revision: note.revision },
  );
  expect((await upload(note.id, webm(4))).status).toBe(404);
  expect(await db().select().from(noteVoiceMemos)).toEqual([]);
});
it('NOTES-B29 an upload to an unknown note stores no audio', async () => {
  const stored = () => readdir(env().FILES_DIR).catch(() => [] as string[]);
  const before = await stored();
  // Random bytes: the key is the content's hash, so an earlier run cannot have stored this one.
  const bytes = crypto.getRandomValues(new Uint8Array(2048));
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  expect((await upload(id(), bytes)).status).toBe(404);
  expect(await stored()).toEqual(before);
});
it('NOTES-I08 a note holds at most twenty voice memos', async () => {
  const note = await createNote();
  for (let index = 0; index < 20; index += 1)
    expect((await upload(note.id, webm(10 + index, 64))).status).toBe(201);
  const over = await upload(note.id, webm(99, 64));
  expect(over.status).toBe(422);
  expect(over.body.error.details).toMatchObject({ reason: 'limit_reached', max: 20 });
});
it('NOTES-B32 the audio answers in full, by range for seeking, 416 outside it, 401 signed out and 404 once gone', async () => {
  const note = await createNote();
  const bytes = webm(5);
  const memo = (await upload(note.id, bytes)).body.data.voiceMemos[0];
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
it('NOTES-B30 removing a memo soft-deletes it, keeps the binary and is audited', async () => {
  const note = await createNote();
  const memo = (await upload(note.id, webm(6))).body.data.voiceMemos[0];
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
  expect(audits.map((entry) => entry.action).sort()).toEqual(['create', 'delete']);
  const again = await json(api.voiceRemove, 'DELETE', `/notes/${note.id}/voice/${memo.id}`, {
    id: note.id,
    memoId: memo.id,
  });
  expect(again.status).toBe(404);
});
it('NOTES-B31 a transcript is stored on the memo and reaches the note only when appendToNote asks', async () => {
  const note = await createNote({ content: 'Opening remarks' });
  const memo = (await upload(note.id, webm(7))).body.data.voiceMemos[0];
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
it('NOTES-B31 appending or refining needs a transcript, and a refused refine leaves the note as it was', async () => {
  const note = await createNote({ content: 'Opening remarks' });
  const memo = (await upload(note.id, webm(8))).body.data.voiceMemos[0];
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
it('NOTES-B32 an Arabic file name is served, its header carrying an ASCII stand-in and the name itself', async () => {
  const note = await createNote();
  const body = new FormData();
  body.set('file', new File([webm(9)], 'مذكرة صوتية.webm'));
  const encoded = new Response(body);
  const raw = new Uint8Array(await encoded.arrayBuffer());
  const request = new Request(new URL(`/api/v1/notes/${note.id}/voice`, env().APP_URL), {
    method: 'POST',
    headers: headers({
      'Content-Type': encoded.headers.get('content-type') ?? '',
      'Content-Length': String(raw.byteLength),
    }),
    body: raw,
  });
  const memo = (await respond(api.voiceUpload, request, { id: note.id })).body.data.voiceMemos[0];
  expect(memo.originalName).toBe('مذكرة صوتية.webm');
  const served = await audio(note.id, memo.id);
  expect(served.status).toBe(200);
  expect(served.headers.get('content-disposition')).toBe(
    `inline; filename="_____ _____.webm"; filename*=UTF-8''${encodeURIComponent('مذكرة صوتية.webm')}`,
  );
});

type Created = {
  id: string;
  title: string;
  content: string;
  committeeId: string | null;
  type: string | null;
  voiceMemos: { transcript: string | null; transcriptionStatus: string; durationSeconds: number }[];
};
it('NOTES-B36 a recording with no note becomes one, named for the day, AI or not', async () => {
  const created = await createFromVoice(webm(20), { durationSeconds: '42' });
  expect(created.status).toBe(201);
  const note = created.body.data as Created;
  expect(note.title).toMatch(/^Voice Memo · \d{4}-\d{2}-\d{2}$/u);
  expect(note.content).toBe('');
  expect(note.voiceMemos).toMatchObject([
    { transcript: null, transcriptionStatus: 'skipped', durationSeconds: 42 },
  ]);
  const audits = await db().select().from(auditLog);
  expect(audits.map((row) => row.entityType).sort()).toEqual(['note', 'note_voice_memo']);
});
it('NOTES-B36 a transcript names the note, fills it and starts its refinement when AI is on', async () => {
  globalThis.enanAiConnection = {
    state: 'enabled',
    checkedAt: new Date().toISOString(),
    error: null,
  };
  const actor = session.user?.id ?? '';
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, actor);
  await writeSetting(db(), 'ai.model.fast', fixtureModel.id, actor);
  const transcript = '## Ship the pilot on Sunday. Budget review follows.';
  const created = await createFromVoice(webm(21), { transcript, type: 'one_on_one' });
  expect(created.status).toBe(201);
  const note = created.body.data as Created;
  expect(note).toMatchObject({ title: 'Ship the pilot on Sunday', content: transcript });
  expect(note.type).toBe('one_on_one');
  expect(note.voiceMemos[0]).toMatchObject({ transcript, transcriptionStatus: 'done' });
  expect(await latestAiJob(db(), actor, note.id, 'ai.notes.refine')).toBeDefined();
});
it('NOTES-B36 with AI off a transcript still creates the note, and no refinement starts', async () => {
  const created = await createFromVoice(webm(22), { transcript: 'Hiring plan for next quarter' });
  expect(created.status).toBe(201);
  const note = created.body.data as Created;
  expect(note.title).toBe('Hiring plan for next quarter');
  expect(
    await latestAiJob(db(), session.user?.id ?? '', note.id, 'ai.notes.refine'),
  ).toBeUndefined();
});
it('NOTES-B36 a disguised file is refused and no note is created', async () => {
  const page = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
  const refused = await createFromVoice(page, { transcript: 'Should not exist' });
  expect(refused.status).toBe(422);
  expect(refused.body.error.details).toMatchObject({ reason: 'unsupported_type' });
  expect(await db().select().from(notes)).toEqual([]);
});
it('NOTES-B36 a title is the first sentence without heading marks, cut at a word to 120', () => {
  expect(voiceNoteTitle(undefined, '2026-10-27')).toBe('Voice Memo · 2026-10-27');
  expect(voiceNoteTitle('\n\n- Quarterly risks? Then more', 'x')).toBe('Quarterly risks?');
  const long = voiceNoteTitle('word '.repeat(60), 'x');
  expect(long.length).toBeLessThanOrEqual(120);
  expect(long.endsWith('word…')).toBe(true);
});
