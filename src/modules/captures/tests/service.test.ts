import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { writeSetting } from '@/core/db/settings-repo';
import { files, jobs } from '@/core/db/system-schema';
import { readStoredFile } from '@/core/files/storage';
import { AiPayload } from '@/core/ai/job-schema';
import type { User } from '@/core/http/user-schema';
import { notes, noteVoiceMemos } from '@/modules/notes/schema/db';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
import { captures } from '../schema/db';
import { CaptureCreate } from '../schema/validation';
import { createCapture, getCapture } from '../service';
import { user, webm } from './fixtures';
// CAPTURES-B01: recording through the service against the real database and files directory.
// AI is off unless a scenario turns the connection on.
const ai = vi.hoisted(() => ({ state: 'disabled' }));
vi.mock('@/core/ai/client', () => ({ aiConnection: () => ({ state: ai.state }) }));
vi.mock('@/core/ai/models', () => ({ loadModels: async () => [fixtureModel] }));
beforeAll(() => migrateDatabase());
let recorder: User;
beforeEach(async () => {
  await clearDatabase();
  ai.state = 'disabled';
  recorder = await user('Recorder', 'member');
});
afterAll(() => closeDatabase());
const ctx = () => ({ db: db(), user: recorder, requestId: crypto.randomUUID() });
const recordAudio = (bytes: Uint8Array, fields: Partial<Record<string, string>> = {}) =>
  createCapture(
    ctx(),
    CaptureCreate.parse({ file: new File([new Uint8Array(bytes)], 'Debrief.webm'), ...fields }),
  );
it('CAPTURES-B01 a recording stores its audio first, then one capture, and no note at all', async () => {
  const bytes = webm(1);
  const created = await recordAudio(bytes, { durationSeconds: '48' });
  expect(created).toMatchObject({
    durationSeconds: 48,
    transcript: null,
    status: 'needs_transcript',
    createdBy: recorder.id,
    audioUrl: `/api/v1/captures/${created.id}/audio`,
    suggestions: [],
  });
  const [file] = await db().select().from(files).where(eq(files.id, created.fileId));
  expect(file?.storageKey).toBe(`voice-${file?.sha256}`);
  expect(new Uint8Array(await readStoredFile(file?.storageKey ?? ''))).toEqual(bytes);
  expect(await db().select().from(captures)).toHaveLength(1);
  expect(await db().select().from(notes)).toEqual([]);
  expect(await db().select().from(noteVoiceMemos)).toEqual([]);
});
it('CAPTURES-B01 with AI off the capture waits for a transcript and keeps its audio; no job is queued', async () => {
  const created = await recordAudio(webm(2));
  expect(created.status).toBe('needs_transcript');
  expect(await db().select().from(jobs)).toEqual([]);
  expect((await getCapture(ctx(), created.id)).fileId).toBe(created.fileId);
});
it('CAPTURES-B01 CAPTURES-B05 with AI on the capture is transcribed by the transcription slot on its own job kind', async () => {
  ai.state = 'enabled';
  await writeSetting(db(), 'ai.model.transcription', 'openai/whisper-large-v3', recorder.id);
  const created = await recordAudio(webm(3), { durationSeconds: '30' });
  expect(created.status).toBe('transcribing');
  const queued = await db().select().from(jobs);
  expect(queued.map((job) => [job.kind, job.dedupKey])).toEqual([
    ['ai.captures.transcribe', `captures.transcribe:${created.id}`],
  ]);
  const payload = AiPayload.parse(queued[0]?.payload);
  expect(payload).toMatchObject({
    capability: 'notes.transcribe',
    input: { captureId: created.id },
  });
  expect(payload.model.id).toBe('openai/whisper-large-v3');
  expect(payload.reservedCostMicros).toBe(2 * 30 * 100);
});
it('CAPTURES-B01 a transcription that found no speech or timed out leaves the capture, failed with its reason', async () => {
  ai.state = 'enabled';
  for (const [seed, reason] of [
    [4, 'no_speech'],
    [5, 'timeout'],
  ] as const) {
    const created = await recordAudio(webm(seed));
    await db()
      .update(jobs)
      .set({ status: 'failed', lastError: reason })
      .where(eq(jobs.id, created.transcribeJobId ?? ''));
    const failed = await getCapture(ctx(), created.id);
    expect(failed).toMatchObject({ status: 'failed', errorCode: reason, fileId: created.fileId });
  }
  expect(await db().select().from(captures)).toHaveLength(2);
  expect(await db().select().from(notes)).toEqual([]);
});
