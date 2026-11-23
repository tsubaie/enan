import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { writeSetting } from '@/core/db/settings-repo';
import { enqueue, queueCapacity } from '@/core/db/jobs-repo';
import { jobs } from '@/core/db/system-schema';
import { AiPayload } from '@/core/ai/job-schema';
import type { User } from '@/core/http/user-schema';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
import * as api from '../api';
import { captures } from '../schema/db';
import { call, record, user, webm } from './fixtures';
// CAPTURES-B22 CAPTURES-B23 CAPTURES-B24: the capture routes against the real database, with the provider's
// state, the workspace switches and the month's usage as the seams a scenario turns.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
const ai = vi.hoisted(() => ({
  state: 'enabled',
  jobs: true,
  key: 'test-key' as string | undefined,
  rateLimited: false,
}));
vi.mock('@/core/ai/client', () => ({ aiConnection: () => ({ state: ai.state }) }));
vi.mock('@/core/ai/models', () => ({ loadModels: async () => [fixtureModel] }));
vi.mock('@/core/config/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/config/env')>();
  return {
    ...original,
    env: () => ({
      ...original.env(),
      JOBS_ENABLED: ai.jobs,
      OPENROUTER_API_KEY: ai.key,
      AI_RATE_LIMIT_ENABLED: ai.rateLimited,
    }),
  };
});
// The month's usage at the per-person limit, only while a scenario asks for it.
vi.mock('@/core/db/ai-jobs-repo', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/core/db/ai-jobs-repo')>();
  return {
    ...original,
    aiAdmissionUsage: async (...args: Parameters<typeof original.aiAdmissionUsage>) =>
      ai.rateLimited
        ? { count: 30, costMicros: 0, retryAfterMs: 60000 }
        : original.aiAdmissionUsage(...args),
  };
});
beforeAll(() => migrateDatabase());
afterAll(() => closeDatabase());
let recorder: User;
beforeEach(async () => {
  await clearDatabase();
  Object.assign(ai, { state: 'enabled', jobs: true, key: 'test-key', rateLimited: false });
  recorder = await user('Recorder', 'member');
  session.user = recorder;
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, recorder.id);
});
const typed = 'Send the risk report before Sunday.';
// A recording AI could not take: stored, waiting for a transcript.
async function waiting(seed: number) {
  ai.state = 'disabled';
  const created = await record(api.create, webm(seed), { durationSeconds: '12' });
  expect(created.status).toBe(201);
  expect(created.body.data.status).toBe('needs_transcript');
  ai.state = 'enabled';
  return created.body.data.id as string;
}
const typeIt = (captureId: string) =>
  call(
    api.transcript,
    'POST',
    `/captures/${captureId}/transcript`,
    { id: captureId },
    {
      transcript: typed,
    },
  );
const stored = async (captureId: string) =>
  (await db().select().from(captures).where(eq(captures.id, captureId)))[0];
// The answer a refusal absorbed by interpretOrHold has always given: 200, the capture failed with
// ai_unavailable. What changes is only that the words were committed before.
async function expectHeld(captureId: string) {
  const response = await typeIt(captureId);
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({
    status: 'failed',
    errorCode: 'ai_unavailable',
    transcript: typed,
  });
  expect(await stored(captureId)).toMatchObject({ transcript: typed, status: 'failed' });
}
it('CAPTURES-B23 over the monthly budget the typed transcript is kept and the answer is unchanged', async () => {
  const captureId = await waiting(1);
  await writeSetting(db(), 'ai.monthly_budget_micros', 1, recorder.id);
  await expectHeld(captureId);
});
it('CAPTURES-B23 at the rate limit the typed transcript is kept and the answer is unchanged', async () => {
  const captureId = await waiting(2);
  ai.rateLimited = true;
  await expectHeld(captureId);
});
it('CAPTURES-B23 with the provider failing the typed transcript is kept and the answer is unchanged', async () => {
  const captureId = await waiting(3);
  ai.state = 'error';
  await expectHeld(captureId);
});
it('CAPTURES-B23 with AI off the typed transcript is kept and the answer is unchanged', async () => {
  const captureId = await waiting(4);
  ai.jobs = false;
  await expectHeld(captureId);
});
it('CAPTURES-B23 with the queue full the request still answers 429, the typed transcript is kept, and Retry interprets it without transcribing again', async () => {
  const captureId = await waiting(5);
  await withTransaction(db(), async (database) => {
    for (let index = 0; index < queueCapacity; index++)
      await enqueue(database, 'ai.captures.interpret', {}, `filler:${index}`, recorder.id);
  });
  const refused = await typeIt(captureId);
  expect(refused.status).toBe(429);
  expect(refused.body.error).toMatchObject({ code: 'rate_limited', details: { scope: 'queue' } });
  // The S17 failed card, holding the words; no interpretation job of its own was queued.
  expect(await stored(captureId)).toMatchObject({
    transcript: typed,
    status: 'failed',
    interpretJobId: null,
  });
  await db().delete(jobs);
  const retried = await call(
    api.interpret,
    'POST',
    `/captures/${captureId}/interpret`,
    { id: captureId },
    {},
  );
  expect(retried.status).toBe(200);
  expect(retried.body.data).toMatchObject({ status: 'interpreting', transcript: typed });
  const queued = await db().select().from(jobs);
  expect(queued.map((job) => job.kind)).toEqual(['ai.captures.interpret']);
  expect(AiPayload.parse(queued[0]?.payload).input).toMatchObject({ transcript: typed });
});
const transcribeAgain = (captureId: string) =>
  call(api.transcribe, 'POST', `/captures/${captureId}/transcribe`, { id: captureId }, {});
it('CAPTURES-B24 transcription is refused with 409 transcript_exists once a transcript is stored', async () => {
  const captureId = await waiting(7);
  ai.jobs = false;
  await expectHeld(captureId);
  ai.jobs = true;
  const refused = await transcribeAgain(captureId);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toMatchObject({
    code: 'conflict',
    details: { reason: 'transcript_exists' },
  });
  expect(await stored(captureId)).toMatchObject({ transcript: typed, status: 'failed' });
  expect(await db().select().from(jobs)).toEqual([]);
});
it('CAPTURES-B24 a transcript typed into a full queue survives a later transcription request', async () => {
  const captureId = await waiting(8);
  await withTransaction(db(), async (database) => {
    for (let index = 0; index < queueCapacity; index++)
      await enqueue(database, 'ai.captures.interpret', {}, `filler:${index}`, recorder.id);
  });
  expect((await typeIt(captureId)).status).toBe(429);
  await db().delete(jobs);
  const refused = await transcribeAgain(captureId);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toMatchObject({ details: { reason: 'transcript_exists' } });
  expect(await stored(captureId)).toMatchObject({
    transcript: typed,
    status: 'failed',
    interpretJobId: null,
  });
});
it('CAPTURES-B23 when AI can take it, a typed transcript goes straight to interpretation', async () => {
  const captureId = await waiting(6);
  const response = await typeIt(captureId);
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ status: 'interpreting', transcript: typed });
});
const listed = async () => (await call(api.list, 'GET', '/captures')).body.meta.transcription;
it('CAPTURES-B22 the list says transcription is off with jobs off, no provider key, or transcription not enabled', async () => {
  expect(await listed()).toBe('available');
  ai.jobs = false;
  expect(await listed()).toBe('off');
  ai.jobs = true;
  ai.key = undefined;
  expect(await listed()).toBe('off');
  ai.key = 'test-key';
  await writeSetting(db(), 'ai.enabled_capabilities', ['captures.interpret'], recorder.id);
  expect(await listed()).toBe('off');
});
it('CAPTURES-B22 the list says transcription is available while the provider fails, the budget is spent or the rate limit is reached', async () => {
  ai.state = 'error';
  expect(await listed()).toBe('available');
  ai.state = 'enabled';
  await writeSetting(db(), 'ai.monthly_budget_micros', 1, recorder.id);
  ai.rateLimited = true;
  expect(await listed()).toBe('available');
});
