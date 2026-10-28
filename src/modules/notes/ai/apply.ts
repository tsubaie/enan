/** NOTES-B17: only explicit review writes notes and tasks, atomically and once. */
import 'server-only';
import { z } from 'zod';
import { type Context } from '@/core/auth/session';
import { AppError } from '@/core/http/errors';
import { transactional } from '@/core/db/transaction';
import { applied, reviewJob } from '@/core/ai/review';
import { lockedAiJob, updateAiResult } from '@/core/db/ai-jobs-repo';
import { AiOutput, AiPayload } from '@/core/ai/job-schema';
import { peopleForAi } from '../service';
import { getNote, patchNote } from '../service';
import { Tags } from '../schema/validation';
import { NoteAiApply, RefinementOutput, TagOutput, SuggestedTask } from '../schema/validation';
import { derivedParticipants } from '../schema/validation';
import { pendingRefinement, reviewRefinement } from '../repo';
// Receives the apply's own context, so the tasks it creates share the apply's transaction.
type CreateTask = (
  ctx: Context,
  task: z.infer<typeof SuggestedTask>,
  ownerId: string | null,
) => Promise<string>;
function selected<T>(values: T[], indexes: number[]) {
  return indexes.map((index) => {
    const value = values[index];
    if (value === undefined) throw new AppError('validation_failed');
    return value;
  });
}
// ADMIN-B36: the created tasks, the note patch and the apply mark commit together.
export const applyNoteAi = transactional(async function applyNoteAi(
  ctx: Context,
  noteId: string,
  input: z.infer<typeof NoteAiApply>,
  capability: 'notes.refine' | 'notes.suggest_tags',
  createTask: CreateTask,
) {
  const { payload, result } = await reviewJob(ctx, input.jobId, noteId, capability);
  if (result.appliedIds) return { ids: result.appliedIds };
  const note = await getNote(ctx, noteId);
  if (note.revision !== payload.revision) throw new AppError('conflict', { reason: 'revision' });
  const { refined, chosenTags, chosenTasks } = choices(result.output, capability, input);
  const people = await peopleForAi(ctx);
  const content =
    input.acceptContent && refined ? (input.content ?? refined.refined_content) : null;
  const mergedTags = [...note.tags, ...chosenTags].filter(
    (tag, index, all) =>
      all.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index,
  );
  if (mergedTags.length > 10) throw new AppError('rule_violation', { rule: 'NOTES-I03' });
  const ids: string[] = [];
  for (const task of chosenTasks) {
    ids.push(await createTask(ctx, task, ownerFor(task.owner_name, people)));
  }
  // Only accepted content touches the body and the participants; tags alone leave both as they are.
  await patchNote(ctx, noteId, {
    revision: note.revision,
    tags: Tags.parse(mergedTags),
    ...(content === null
      ? {}
      : {
          content,
          // NOTES-B08: everyone already on the note stays; anyone the new text mentions is added,
          // from the directory or by the display name a participant has on this note.
          participantIds: [
            ...new Set([
              ...note.participants.map((person) => person.id),
              ...derivedParticipants(content, [...people, ...note.participants]),
            ]),
          ],
        }),
  });
  await applied(ctx, input.jobId, result, ids);
  if (refined) await reviewRefinement(ctx.db, input.jobId, 'applied', ctx.user.id, ids);
  return { ids };
});
export const discardNoteAi = transactional(async function discardNoteAi(
  ctx: Context,
  noteId: string,
  jobId: string,
  capability: 'notes.refine' | 'notes.suggest_tags',
) {
  const { result } = await reviewJob(ctx, jobId, noteId, capability);
  if (result.appliedIds) throw new AppError('conflict', { reason: 'state' });
  await updateAiResult(ctx.db, jobId, { ...result, discarded: true });
  if (capability === 'notes.refine')
    await reviewRefinement(ctx.db, jobId, 'discarded', ctx.user.id);
  return { ids: [] };
});
// NOTES-B18: Discard is reversible for a moment. Restoring puts a discarded, unapplied proposal
// back: pending when the note still stands at the job's revision, stale otherwise.
export const restoreNoteAi = transactional(async function restoreNoteAi(
  ctx: Context,
  noteId: string,
  jobId: string,
) {
  const job = await lockedAiJob(ctx.db, jobId);
  if (!job || (job.createdBy !== ctx.user.id && ctx.user.role !== 'admin'))
    throw new AppError('not_found');
  const payload = AiPayload.parse(job.payload);
  if (job.kind !== 'ai.notes.refine' || payload.entityId !== noteId || job.status !== 'succeeded')
    throw new AppError('conflict', { reason: 'state' });
  const result = AiOutput.parse(job.result);
  if (result.appliedIds) throw new AppError('conflict', { reason: 'state' });
  const note = await getNote(ctx, noteId);
  const current = note.revision === payload.revision;
  // A note holds one pending proposal: a newer one took the place, so the undo is refused;
  // the job's own pending row means the undo already ran, and runs again unchanged.
  const pending = current ? await pendingRefinement(ctx.db, noteId) : undefined;
  if (pending && pending.jobId !== jobId) throw new AppError('conflict', { reason: 'state' });
  await updateAiResult(ctx.db, jobId, { ...result, discarded: false });
  await reviewRefinement(ctx.db, jobId, current ? 'pending' : 'stale', ctx.user.id);
  return { ids: [] };
});

function choices(
  output: z.infer<ReturnType<typeof z.json>>,
  capability: string,
  input: z.infer<typeof NoteAiApply>,
) {
  const refined = capability === 'notes.refine' ? RefinementOutput.parse(output) : null;
  const tags = refined?.suggested_tags ?? TagOutput.parse(output).tags;
  if (!refined && (input.acceptContent || input.taskIndexes.length))
    throw new AppError('validation_failed');
  const chosenTags = selected(tags, input.tagIndexes);
  const chosenTasks = selected(refined?.suggested_tasks ?? [], input.taskIndexes).map(
    (task, position) => ({
      ...task,
      title:
        input.taskTitles?.find((edit) => edit.index === input.taskIndexes[position])?.title ??
        task.title,
    }),
  );
  if (!input.acceptContent && !chosenTags.length && !chosenTasks.length)
    throw new AppError('validation_failed');
  return { refined, chosenTags, chosenTasks };
}
function ownerFor(
  name: string | null,
  people: { id: string; name: string; isAssignable: boolean }[],
) {
  const matches = people.filter((person) => person.isAssignable && person.name === name);
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}
