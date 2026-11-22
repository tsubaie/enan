import 'server-only';
import { z } from 'zod';
import { type JobHandler } from '@/core/jobs/types';
import { executeAi } from '@/core/ai/execute';
import { transcribeStoredAudio } from '@/core/ai/transcribe';
import { AiOutput, AiPayload } from '@/core/ai/job-schema';
import { userById } from '@/core/db/auth-repo';
import { db, type Database } from '@/core/db/client';
import { type Claimed } from '@/core/db/jobs-repo';
import { id } from '@/core/db/ids';
import { AppError } from '@/core/http/errors';
import { User } from '@/core/http/user-schema';
import * as repo from './repo';
import { interpretOrHold } from './service';
import { INTERPRET_PROMPT } from './ai/prompt';
import { InterpretInput, InterpretOutput, toSuggestions } from './ai/interpret';
import { SuggestionContent } from './schema/validation';
// CAPTURES-B03 CAPTURES-B05 (§4.2, §4.3, § Security 3 and 10): both jobs publish only onto the
// capture their payload names, and only while that capture still waits on this very job. They
// write a transcript or drafts and nothing else: no note, no task, no notification, no refine.
const TranscribeInput = z.object({ captureId: z.uuid() });
const Transcribed = z.object({ transcript: z.string().min(1) });
const Interpreted = z.object({ suggestions: z.array(SuggestionContent).min(1) });
async function waitingOn(
  database: Database,
  job: Claimed,
  captureId: string,
  step: 'transcribe' | 'interpret',
) {
  const capture = await repo.selectStoredCapture(database, captureId);
  if (!capture || capture.deletedAt) return null;
  const current = step === 'transcribe' ? capture.transcribeJobId : capture.interpretJobId;
  return current === job.id ? capture : null;
}
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
      if (!capture) return;
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
    },
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
    },
  },
};
