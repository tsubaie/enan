import 'server-only';
import { z } from 'zod';
import { type JobHandler } from '@/core/jobs/types';
import { executeAi } from '@/core/ai/execute';
import { transcribeStoredAudio } from '@/core/ai/transcribe';
import { AiOutput, AiPayload } from '@/core/ai/job-schema';
import { userById } from '@/core/db/auth-repo';
import { assertWriteLock, db, type Database } from '@/core/db/client';
import { type Claimed } from '@/core/db/jobs-repo';
import { id } from '@/core/db/ids';
import { AppError } from '@/core/http/errors';
import { User } from '@/core/http/user-schema';
import * as repo from './repo';
import { interpretOrHold } from './service';
import { notifyFailed, notifyReady } from './notifications';
import { INTERPRET_PROMPT } from './ai/prompt';
import { InterpretInput, InterpretOutput, toSuggestions } from './ai/interpret';
import { SuggestionContent } from './schema/validation';
// CAPTURES-B03 CAPTURES-B05 (§4.2, §4.3, § Security 3 and 10): both jobs publish only onto the
// capture their payload names, and only while that capture still waits on this very job. They
// write a transcript or drafts and nothing else: no note, no task, no refine, and no notification
// but the recorder's own ready or failed line (CAPTURES-B21, ADR 0073), written behind the same
// fence in the same transaction.
const TranscribeInput = z.object({ captureId: z.uuid() });
const Transcribed = z.object({ transcript: z.string().min(1) });
const Interpreted = z.object({ suggestions: z.array(SuggestionContent).min(1) });
async function waitingOn(
  database: Database,
  job: Claimed,
  captureId: string,
  step: 'transcribe' | 'interpret',
) {
  // The fence and the result's write share the runner's publish transaction (BEGIN IMMEDIATE, see
  // jobs-repo `publish`), so a delete or a restore cannot land between this read and the write.
  assertWriteLock(database);
  const capture = await repo.selectStoredCapture(database, captureId);
  if (!capture || capture.deletedAt) return null;
  const current = step === 'transcribe' ? capture.transcribeJobId : capture.interpretJobId;
  return current === job.id ? capture : null;
}
// CAPTURES-B21: a job that failed for good tells the recorder, while the capture still waits on it
// and is not deleted; a restore later (CAPTURES-B13 `interrupted`) emits nothing.
const failedFor =
  (step: 'transcribe' | 'interpret'): NonNullable<JobHandler['finished']> =>
  async (database, job, outcome) => {
    if (outcome !== 'failed') return;
    const input = z.object({ captureId: z.uuid() }).safeParse(AiPayload.parse(job.payload).input);
    const capture = input.success
      ? await waitingOn(database, job, input.data.captureId, step)
      : null;
    if (capture) await notifyFailed(database, capture);
  };
export const captureJobs: Record<string, JobHandler> = {
  'ai.captures.transcribe': {
    concurrency: 2,
    schema: AiPayload,
    run: async (job, signal) => {
      const { captureId } = TranscribeInput.parse(AiPayload.parse(job.payload).input);
      const audio = await repo.selectCaptureAudio(db(), captureId);
      const transcript = await transcribeStoredAudio(job, audio, signal);
      return { output: { transcript }, warnings: [] };
    },
    publish: async (database, job, raw) => {
      const { captureId } = TranscribeInput.parse(AiPayload.parse(job.payload).input);
      const { transcript } = Transcribed.parse(AiOutput.parse(raw).output);
      const capture = await waitingOn(database, job, captureId, 'transcribe');
      // CAPTURES-B24: a transcript already stored (typed, say) is never replaced by transcription.
      if (!capture || capture.transcript) return;
      await repo.updateCapture(database, captureId, { transcript, status: 'interpreting' });
      // Interpretation is admitted as the member who recorded it; whatever refuses it (AI off,
      // over budget, a full queue) leaves the capture failed with that reason and the transcript.
      const user = job.createdBy ? await userById(database, job.createdBy) : undefined;
      if (!user)
        return repo.updateCapture(database, captureId, {
          status: 'failed',
          errorCode: 'ai_unavailable',
        });
      await interpretOrHold({ db: database, user: User.parse(user), requestId: id() }, captureId, [
        'ai_unavailable',
        'rate_limited',
        'conflict',
      ]);
      // A refusal of the interpretation it asked for failed the capture inside this publish.
      if ((await repo.selectStoredCapture(database, captureId))?.status === 'failed')
        await notifyFailed(database, capture);
    },
    finished: failedFor('transcribe'),
  },
  'ai.captures.interpret': {
    concurrency: 2,
    schema: AiPayload,
    run: async (job, signal) => {
      const input = InterpretInput.parse(AiPayload.parse(job.payload).input);
      const output = await executeAi(job, INTERPRET_PROMPT, InterpretOutput, signal);
      const suggestions = toSuggestions(output, input);
      // Q8: nothing valid to review is a failure the recorder can retry, not an empty inbox.
      if (!suggestions.length) throw new AppError('ai_failed', { reason: 'interpret_failed' });
      const warnings = suggestions.length < output.suggestions.length ? ['invalid_suggestion'] : [];
      return { output: z.json().parse({ suggestions }), warnings };
    },
    publish: async (database, job, raw) => {
      const input = InterpretInput.parse(AiPayload.parse(job.payload).input);
      const { suggestions } = Interpreted.parse(AiOutput.parse(raw).output);
      const capture = await waitingOn(database, job, input.captureId, 'interpret');
      if (!capture || capture.transcript !== input.transcript) return;
      await repo.replacePendingSuggestions(
        database,
        capture.id,
        id(),
        suggestions.map((suggestion) => ({
          id: id(),
          captureId: capture.id,
          ...suggestion,
          createdBy: capture.createdBy,
        })),
      );
      await repo.updateCapture(database, capture.id, { status: 'ready', errorCode: null });
      await notifyReady(database, capture);
    },
    finished: failedFor('interpret'),
  },
};
