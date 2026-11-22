import 'server-only';
import { z } from 'zod';
import { type JobHandler } from '@/core/jobs/types';
import { executeAi } from '@/core/ai/execute';
import { AiPayload, AiOutput } from '@/core/ai/job-schema';
import { id } from '@/core/db/ids';
import { RefinementOutput, TagOutput, modelTags } from './schema/validation';
import { TAG_PROMPT } from './ai/prompts/refine.v1';
import { refinePrompt } from './ai/prompts/select';
import { lockNote, insertRefinement } from './repo';
import { transcribeStoredAudio } from '@/core/ai/transcribe';
import { userById } from '@/core/db/auth-repo';
import { db, type Database } from '@/core/db/client';
import { User } from '@/core/http/user-schema';
import { AppError } from '@/core/http/errors';
import { applyNoteAi } from './ai/apply';
import { NoteAiApply } from './schema/validation';
import * as voiceRepo from './voice/repo';
const TranscribeInput = z.object({ noteId: z.uuid(), memoId: z.uuid() });
const Transcribed = z.object({ transcript: z.string() });
// A job acts for the member who asked for it, in the transaction its result is published in.
async function actingAs(database: Database, userId: string | null) {
  const user = userId ? await userById(database, userId) : undefined;
  return user ? { db: database, user: User.parse(user), requestId: id() } : null;
}
// Something the note's own rules refuse (it moved on, it was trashed, it is full) leaves the
// note as it is; the transcript stays on its memo and the refinement stays a proposal.
const refused = (error: unknown) => {
  if (!(error instanceof AppError)) throw error;
};
export const noteJobs: Record<string, JobHandler> = {
  'ai.notes.refine': {
    concurrency: 2,
    schema: AiPayload,
    run: async (job, signal) => {
      const prompt = refinePrompt(AiPayload.parse(job.payload).promptVersion);
      const output = await executeAi(job, prompt, RefinementOutput, signal);
      const input = z
        .object({ assignablePeople: z.array(z.string()), content: z.string() })
        .parse(AiPayload.parse(job.payload).input);
      const warnings: string[] = [];
      const suggested_tasks = output.suggested_tasks
        .filter(
          (task, index, all) => all.findIndex((other) => other.title === task.title) === index,
        )
        .map((task) => {
          const owner_name =
            task.owner_name && input.assignablePeople.includes(task.owner_name)
              ? task.owner_name
              : null;
          const due_date =
            task.due_date && z.iso.date().safeParse(task.due_date).success ? task.due_date : null;
          const source_snippet =
            task.source_snippet && input.content.includes(task.source_snippet)
              ? task.source_snippet
              : null;
          if (
            owner_name !== task.owner_name ||
            due_date !== task.due_date ||
            source_snippet !== task.source_snippet
          )
            warnings.push('invalid_task_context');
          return { ...task, owner_name, due_date, source_snippet };
        });
      return {
        output: { ...output, suggested_tasks, suggested_tags: modelTags(output.suggested_tags) },
        warnings,
      };
    },
    publish: async (database, job, raw) => {
      const payload = AiPayload.parse(job.payload);
      const output = RefinementOutput.parse(AiOutput.parse(raw).output);
      const note = await lockNote(database, payload.entityId);
      if (!note) return;
      await insertRefinement(database, {
        id: id(),
        noteId: note.id,
        jobId: job.id,
        noteRevision: payload.revision,
        contentHash: payload.contentHash,
        capabilityVersion: 1,
        refinedContent: output.refined_content,
        suggestedTasks: output.suggested_tasks,
        suggestedTags: output.suggested_tags,
        summaryOfChanges: output.summary_of_changes,
        status: note.revision === payload.revision && !note.deletedAt ? 'pending' : 'stale',
        createdBy: job.createdBy,
      });
      // NOTES-B37: a refinement a transcription started writes itself in, as an accepted rewrite
      // would; a note edited meanwhile refuses it and the proposal waits for review instead.
      const ctx = payload.autoApply ? await actingAs(database, job.createdBy) : null;
      if (ctx)
        await applyNoteAi(
          ctx,
          note.id,
          NoteAiApply.parse({
            jobId: job.id,
            acceptContent: true,
            taskIndexes: [],
            tagIndexes: [],
          }),
          'notes.refine',
          async () => {
            throw new AppError('validation_failed');
          },
        ).catch(refused);
    },
  },
  'ai.notes.transcribe': {
    concurrency: 2,
    schema: AiPayload,
    run: async (job, signal) => {
      const { noteId, memoId } = TranscribeInput.parse(AiPayload.parse(job.payload).input);
      const memo = await voiceRepo.selectVoiceMemo(db(), noteId, memoId);
      const transcript = await transcribeStoredAudio(job, memo, signal);
      return { output: { transcript }, warnings: [] };
    },
    publish: async (database, job, raw) => {
      const { noteId, memoId } = TranscribeInput.parse(AiPayload.parse(job.payload).input);
      const { transcript } = Transcribed.parse(AiOutput.parse(raw).output);
      const note = await lockNote(database, noteId);
      const memo = await voiceRepo.selectVoiceMemo(database, noteId, memoId);
      if (!note || !memo || memo.transcriptionJobId !== job.id) return;
      // CAPTURES-B05 (ADR 0071): the transcript stays on the memo. Nothing is appended to the note
      // and no rewrite starts by itself; Insert into Note is the reader's own action (NOTES-B31).
      await voiceRepo.updateVoiceMemo(database, memoId, {
        transcript,
        transcriptionStatus: 'done',
        transcriptionError: null,
      });
    },
  },
  'ai.notes.suggest_tags': {
    concurrency: 2,
    schema: AiPayload,
    run: async (job, signal) => {
      const output = await executeAi(job, TAG_PROMPT, TagOutput, signal);
      return { output: { tags: modelTags(output.tags) }, warnings: [] };
    },
    publish: async () => {},
  },
};
