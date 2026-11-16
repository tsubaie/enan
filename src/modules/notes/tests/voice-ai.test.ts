import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, closeDatabase, withTransaction } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { writeSetting } from '@/core/db/settings-repo';
import { aiInvocations, jobs } from '@/core/db/system-schema';
import { AiPayload } from '@/core/ai/job-schema';
import { fixtureModel, finishedJob } from '../../../../tests/fixtures/ai/jobs';
import refinement from '../../../../tests/fixtures/ai/notes.refine.v1.en.json';
import { harness, actorId } from './fixtures';
import { noteJobs } from '../jobs';
import { getNote, patchNote } from '../service';
import { createNoteFromVoice, transcribeWithAi, uploadVoiceMemo } from '../voice/service';
import { VoiceCreate, VoiceUpload } from '../schema/validation';
// The network is the only stand-in: admission, the job's handlers and the note's own rules run
// against the real database, and the transcription request goes through the real provider code.
const sdk = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/core/ai/sdk', () => ({ aiClient: async () => ({ post: sdk.post }) }));
vi.mock('@/core/ai/models', () => ({ loadModels: async () => [fixtureModel] }));
vi.mock('@/core/ai/client', () => ({ aiConnection: () => ({ state: 'enabled' }) }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await harness.reset();
  sdk.post.mockReset();
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, actorId());
  await writeSetting(db(), 'ai.model.transcription', 'openai/whisper-large-v3', actorId());
});
afterAll(() => closeDatabase());
const webm = (seed: number) => {
  const audio = new Uint8Array(2048).map((_, index) => (index * 31 + seed) % 251);
  audio.set([0x1a, 0x45, 0xdf, 0xa3]);
  return new File([audio], 'Voice memo.webm');
};
const jobRow = async (jobId: string) => {
  const [row] = await db().select().from(jobs).where(eq(jobs.id, jobId));
  if (!row) throw new Error(`no job ${jobId}`);
  return row;
};
async function recordedNote() {
  const note = await harness.run((ctx) =>
    createNoteFromVoice(ctx, VoiceCreate.parse({ file: webm(1), durationSeconds: 30 })),
  );
  const [memo] = note.voiceMemos;
  if (!memo?.transcriptionJobId) throw new Error('the memo is not waiting on a job');
  return { note, memo, job: await jobRow(memo.transcriptionJobId) };
}
const handler = (kind: string) => {
  const found = noteJobs[kind];
  if (!found) throw new Error(`no handler for ${kind}`);
  return found;
};
it('NOTES-B37 a recording saved without a transcript waits on a transcription job of its own', async () => {
  const { note, memo, job } = await recordedNote();
  expect(note).toMatchObject({ content: '', title: expect.stringMatching(/^Voice Memo · /u) });
  expect(memo.transcriptionStatus).toBe('pending');
  const payload = AiPayload.parse(job.payload);
  expect(job).toMatchObject({ kind: 'ai.notes.transcribe', status: 'queued', entityId: memo.id });
  expect(payload.model.id).toBe('openai/whisper-large-v3');
  expect(payload.input).toEqual({ noteId: note.id, memoId: memo.id });
  // ADR 0070: both attempts at the per-second ceiling, for the memo's 30 seconds.
  expect(payload.reservedCostMicros).toBe(2 * 30 * 100);
  // A second recording on the same note is transcribed on its own, not folded into the first.
  const again = await harness.run((ctx) =>
    uploadVoiceMemo(ctx, note.id, VoiceUpload.parse({ file: webm(2), durationSeconds: 5 })),
  );
  const ids = again.voiceMemos.map((entry) => entry.transcriptionJobId);
  expect(new Set(ids).size).toBe(2);
});
it('NOTES-B37 the transcript writes the note and starts a refinement that applies itself', async () => {
  const { note, memo, job } = await recordedNote();
  sdk.post.mockResolvedValue({
    text: ' Approve the budget by Thursday. Then brief the board. ',
    usage: { cost: 0.0002, seconds: 30 },
  });
  const result = await handler(job.kind).run(job, new AbortController().signal);
  const [path, options] = sdk.post.mock.calls[0] ?? [];
  expect(path).toBe('/v1/audio/transcriptions');
  expect(options.body.model).toBe('openai/whisper-large-v3');
  expect(options.body.input_audio.format).toBe('webm');
  expect(Buffer.from(options.body.input_audio.data, 'base64').subarray(0, 4)).toEqual(
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  );
  const [invocation] = await db()
    .select()
    .from(aiInvocations)
    .where(eq(aiInvocations.jobId, job.id));
  expect(invocation).toMatchObject({ status: 'ok', estimatedCostMicros: 200 });
  await withTransaction(db(), (database) => handler(job.kind).publish(database, job, result));
  const written = await harness.run((ctx) => getNote(ctx, note.id));
  expect(written.content).toBe('Approve the budget by Thursday. Then brief the board.');
  expect(written.title).toBe('Approve the budget by Thursday');
  expect(written.voiceMemos.find((entry) => entry.id === memo.id)).toMatchObject({
    transcriptionStatus: 'done',
    transcript: 'Approve the budget by Thursday. Then brief the board.',
  });
  const [refine] = await db().select().from(jobs).where(eq(jobs.kind, 'ai.notes.refine'));
  expect(refine).toMatchObject({ entityId: note.id, status: 'queued' });
  expect(AiPayload.parse(refine?.payload)).toMatchObject({
    autoApply: true,
    revision: written.revision,
  });
});
it('NOTES-B37 a memo on a note the reader wrote appends its transcript and leaves the rewrite to review', async () => {
  const typed = await harness.note('Board minutes', { content: 'Our own minutes.' });
  const note = await harness.run((ctx) =>
    uploadVoiceMemo(ctx, typed.id, VoiceUpload.parse({ file: webm(3), durationSeconds: 8 })),
  );
  const job = await jobRow(note.voiceMemos[0]?.transcriptionJobId ?? '');
  sdk.post.mockResolvedValue({ text: 'Add the audit to the agenda.' });
  const result = await handler(job.kind).run(job, new AbortController().signal);
  await withTransaction(db(), (database) => handler(job.kind).publish(database, job, result));
  const written = await harness.run((ctx) => getNote(ctx, typed.id));
  expect(written).toMatchObject({
    title: 'Board minutes',
    content: 'Our own minutes.\n\nAdd the audit to the agenda.',
  });
  const [refine] = await db().select().from(jobs).where(eq(jobs.kind, 'ai.notes.refine'));
  expect(AiPayload.parse(refine?.payload).autoApply).toBeFalsy();
});
it('NOTES-B37 a self-applying refinement writes the note, unless the reader has edited it since', async () => {
  const note = await harness.note('Voice Memo · 2026-09-10', { content: 'raw transcript' });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
    {},
    { autoApply: true },
  );
  await withTransaction(db(), (database) =>
    handler(job.kind).publish(database, job, z.json().parse(job.result)),
  );
  const applied = await harness.run((ctx) => getNote(ctx, note.id));
  expect(applied.content).toBe(refinement.refined_content);
  const rows = await db().all<{ status: string }>(
    sql`select status from note_refinements where job_id = ${job.id}`,
  );
  expect(rows[0]?.status).toBe('applied');
  // Overtaken: the reader's edit stands and the rewrite is not forced over it.
  const edited = await harness.note('Board call', { content: 'raw' });
  const late = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    edited.id,
    edited.revision,
    refinement,
    {},
    { autoApply: true },
  );
  await harness.run((ctx) =>
    patchNote(ctx, edited.id, { content: 'my own words', revision: edited.revision }),
  );
  await withTransaction(db(), (database) =>
    handler(late.kind).publish(database, late, z.json().parse(late.result)),
  );
  expect((await harness.run((ctx) => getNote(ctx, edited.id))).content).toBe('my own words');
});
it('NOTES-B37 a transcription that stopped reads as failed, and Transcribe with AI asks again', async () => {
  const { note, memo, job } = await recordedNote();
  await db()
    .update(jobs)
    .set({ status: 'failed', lastError: 'no_speech' })
    .where(eq(jobs.id, job.id));
  const failed = await harness.run((ctx) => getNote(ctx, note.id));
  expect(failed.voiceMemos[0]).toMatchObject({
    transcriptionStatus: 'failed',
    transcriptionError: 'no_speech',
  });
  const retried = await harness.run((ctx) => transcribeWithAi(ctx, note.id, memo.id));
  expect(retried.voiceMemos[0]?.transcriptionStatus).toBe('pending');
  expect(retried.voiceMemos[0]?.transcriptionJobId).not.toBe(job.id);
});
it('NOTES-B37 a recording with no speech fails its job instead of writing an empty note', async () => {
  const { job } = await recordedNote();
  sdk.post.mockResolvedValue({ text: '   ' });
  await expect(handler(job.kind).run(job, new AbortController().signal)).rejects.toMatchObject({
    code: 'ai_failed',
    details: { reason: 'no_speech' },
  });
});
