import 'server-only';
import { z } from 'zod';
import type { Context } from '@/core/auth/session';
import { transactional } from '@/core/db/transaction';
import { writeAudit } from '@/core/db/audit-repo';
import { AppError } from '@/core/http/errors';
import { createTask, getTask, removeTask } from '@/modules/tasks';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { createNote, getNote, removeNote } from '@/modules/notes';
import { NoteCreate } from '@/modules/notes/schema/validation';
import { assertCaptureAccess } from '../access';
import * as repo from '../repo';
import {
  ApproveReady,
  MergeSuggestions,
  Suggestion,
  SuggestionPatch,
  blockers,
  payloadSchemas,
  reshape,
  SuggestionKind,
  payloadFields,
  type Approval,
  type FieldStates,
} from '../schema/validation';
/**
 * Reviewing drafts (ADR 0071): edit, approve, discard, undo and merge.
 * Invariants protected here:
 * - CAPTURES-B02 every draft is reached through `assertCaptureAccess`; another member's, a missing
 *   and a deleted one are the same `not_found`.
 * - CAPTURES-B03 nothing here notifies except the ordinary side effects of the record Approve
 *   creates (`task.assigned` in `createTask`, `note.mentioned` in `createNote`).
 * - CAPTURES-B04 Approve never starts refinement and never passes `autoApply`.
 * - CAPTURES-B10 the live record is created from the edited payload, in the caller's transaction.
 * - CAPTURES-B11 Undo is the server's call: unedited and within 60 seconds, all or nothing.
 */
export const undoWindowMs = 60_000;
type Row = repo.SuggestionRow;
async function visibleSuggestion(ctx: Context, suggestionId: string) {
  const row = await repo.selectSuggestion(ctx.db, suggestionId);
  // A draft deleted with its capture, or replaced by a new interpretation, is as gone as one never
  // made.
  assertCaptureAccess(
    ctx.user,
    row && { createdBy: row.createdBy, deletedAt: row.deletedAt ?? row.suggestion.deletedAt },
  );
  if (!row) throw new AppError('not_found', { entityType: 'capture' });
  return row.suggestion;
}
const view = (row: Row) => Suggestion.parse(row);
const reread = async (ctx: Context, suggestionId: string) =>
  view(await visibleSuggestion(ctx, suggestionId));
function requireRevision(row: Row, revision: number) {
  if (row.revision !== revision)
    throw new AppError('conflict', { reason: 'revision', revision: row.revision });
}
function requirePending(row: Row) {
  if (row.status !== 'pending') throw new AppError('conflict', { reason: 'state' });
}
const payloadOf = (row: Row) => payloadFields(row.payload);
const kindOf = (row: Row) => SuggestionKind.parse(row.kind);
// Fields the reviewer set are settled: their state is `confident` from now on.
function settle(states: FieldStates, fields: string[]): FieldStates {
  const settled = { ...states };
  for (const field of fields) settled[field] = { state: 'confident', candidates: [] };
  return settled;
}
// S18–S22: an edit before Approve. The whole payload is checked against its kind's contract, so a
// draft can never hold a field its kind does not have.
export const patchSuggestion = transactional(async function patchSuggestion(
  ctx: Context,
  suggestionId: string,
  input: SuggestionPatch,
) {
  const row = await visibleSuggestion(ctx, suggestionId);
  requirePending(row);
  requireRevision(row, input.revision);
  const kind = input.kind ?? kindOf(row);
  const merged = { ...payloadOf(row), ...input.payload };
  // Choosing or clearing the owner replaces the words that were heard for it.
  if ('ownerId' in input.payload || merged.spokenOwner === null) delete merged.spokenOwner;
  if (merged.description === null) delete merged.description;
  const parsed = payloadSchemas[kind].safeParse(kind === row.kind ? merged : reshape(kind, merged));
  if (!parsed.success)
    throw new AppError('validation_failed', {
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
  await repo.updateSuggestion(ctx.db, suggestionId, {
    kind,
    payload: parsed.data,
    fieldStates: settle(row.fieldStates, Object.keys(input.payload)),
    typeFlag: input.kind ? null : row.typeFlag,
    revision: row.revision + 1,
  });
  await writeAudit(ctx.db, ctx.user.id, 'update', 'capture_suggestion', suggestionId, {
    fields: Object.keys(input.payload),
    ...(input.kind ? { kind } : {}),
  });
  return reread(ctx, suggestionId);
});
// CAPTURES-B10 CAPTURES-B04: the live record, from the payload as the reviewer left it, through the
// owning module's own create. Nothing else is started.
type Live = { type: 'task' | 'note'; id: string; revision: number };
async function createLive(ctx: Context, row: Row): Promise<Live> {
  const kind = kindOf(row);
  if (kind === 'task') {
    const payload = payloadSchemas.task.parse(row.payload);
    const task = await createTask(
      ctx,
      TaskCreate.parse({
        title: payload.title,
        description: payload.description ?? null,
        status: payload.status,
        priority: payload.priority,
        dueDate: payload.dueDate,
        ownerId: payload.ownerId,
        committeeId: payload.committeeId,
      }),
    );
    return { type: 'task', id: task.id, revision: task.revision };
  }
  const payload = payloadSchemas[kind].parse(row.payload);
  const note = await createNote(
    ctx,
    NoteCreate.parse({
      title: payload.title,
      content: payload.body,
      type: payload.type,
      noteDate: payload.noteDate,
      committeeId: payload.committeeId,
      tags: payload.tags,
      participantIds: payload.participantIds,
    }),
  );
  return { type: 'note', id: note.id, revision: note.revision };
}
const liveOf = (row: Row) =>
  z
    .object({ type: z.enum(['task', 'note']), id: z.uuid() })
    .parse({ type: row.liveEntityType, id: row.liveEntityId });
async function approveRow(ctx: Context, row: Row): Promise<Approval> {
  const missing = blockers(view(row));
  if (missing.length)
    throw new AppError('rule_violation', { reason: 'unresolved', id: row.id, fields: missing });
  const live = await createLive(ctx, row);
  await repo.updateSuggestion(ctx.db, row.id, {
    status: 'approved',
    liveEntityType: live.type,
    liveEntityId: live.id,
    liveRevisionAtApprove: live.revision,
    approvedAt: new Date(),
    approvedBy: ctx.user.id,
  });
  await writeAudit(ctx.db, ctx.user.id, 'approve', 'capture_suggestion', row.id, {
    liveEntityType: live.type,
    liveEntityId: live.id,
  });
  return { suggestion: await reread(ctx, row.id), live: { type: live.type, id: live.id } };
}
// S18 Approve. A second press with the same revision answers with the record the first one made,
// so a double tap never creates two.
export const approveSuggestion = transactional(async function approveSuggestion(
  ctx: Context,
  suggestionId: string,
  revision: number,
): Promise<Approval> {
  const row = await visibleSuggestion(ctx, suggestionId);
  requireRevision(row, revision);
  if (row.status === 'approved') return { suggestion: view(row), live: liveOf(row) };
  requirePending(row);
  return approveRow(ctx, row);
});
// S23 Approve N ready, in one transaction. Listed ids must each be ready (422 otherwise); without
// ids, the reader's own drafts that are ready are approved and the rest are left as they are. A
// type flag never holds a draft back.
export const approveReady = transactional(async function approveReady(
  ctx: Context,
  input: z.output<typeof ApproveReady>,
) {
  const ids =
    input.ids ?? (await repo.selectOwnPendingSuggestions(ctx.db, ctx.user)).map((row) => row.id);
  const approved: Approval[] = [];
  for (const suggestionId of ids) {
    const row = await visibleSuggestion(ctx, suggestionId);
    const ready = row.status === 'pending' && !blockers(view(row)).length;
    if (!ready && input.ids)
      throw new AppError('rule_violation', { reason: 'not_ready', id: suggestionId });
    if (ready) approved.push(await approveRow(ctx, row));
  }
  return { approved };
});
// S25: discard at once, no confirm; Undo brings it back (S28).
export const discardSuggestion = transactional(async function discardSuggestion(
  ctx: Context,
  suggestionId: string,
  revision: number,
) {
  const row = await visibleSuggestion(ctx, suggestionId);
  requireRevision(row, revision);
  if (row.status === 'discarded') return view(row);
  requirePending(row);
  await repo.updateSuggestion(ctx.db, suggestionId, {
    status: 'discarded',
    discardedAt: new Date(),
  });
  await writeAudit(ctx.db, ctx.user.id, 'discard', 'capture_suggestion', suggestionId, {});
  return reread(ctx, suggestionId);
});
const unavailable = () => new AppError('rule_violation', { reason: 'undo_unavailable' });
// CAPTURES-B11: the live record may go only while it is exactly as Approve made it and Approve was
// less than a minute ago. Its own delete checks the revision again, under the same transaction.
async function withdraw(ctx: Context, row: Row) {
  const at = row.approvedAt?.getTime() ?? 0;
  if (Date.now() - at > undoWindowMs || row.liveRevisionAtApprove === null) throw unavailable();
  const live = liveOf(row);
  const current = await (
    live.type === 'task' ? getTask(ctx, live.id) : getNote(ctx, live.id)
  ).catch(() => null);
  if (!current || current.revision !== row.liveRevisionAtApprove) throw unavailable();
  const { opId } = await (live.type === 'task'
    ? removeTask(ctx, live.id, current.revision)
    : removeNote(ctx, live.id, current.revision));
  return opId;
}
// S27: Undo of an approval or a discard returns the draft to pending. Several ids (an Approve N
// ready batch) are one transaction: if any one cannot be undone, none is (§9 decision 10).
export const undoSuggestions = transactional(async function undoSuggestions(
  ctx: Context,
  suggestionIds: string[],
) {
  const undone: Suggestion[] = [];
  for (const suggestionId of suggestionIds) {
    const row = await visibleSuggestion(ctx, suggestionId);
    if (row.status === 'merged') throw new AppError('conflict', { reason: 'state' });
    if (row.status === 'pending') {
      undone.push(view(row));
      continue;
    }
    const opId = row.status === 'approved' ? await withdraw(ctx, row) : null;
    await repo.updateSuggestion(ctx.db, suggestionId, {
      status: 'pending',
      liveEntityType: null,
      liveEntityId: null,
      liveRevisionAtApprove: null,
      approvedAt: null,
      approvedBy: null,
      discardedAt: null,
      revision: row.revision + 1,
    });
    await writeAudit(
      ctx.db,
      ctx.user.id,
      'undo',
      'capture_suggestion',
      suggestionId,
      { from: row.status },
      opId,
    );
    undone.push(await reread(ctx, suggestionId));
  }
  return undone;
});
// S24 (§9 decision 9): drafts of one recording and one kind become one. The kept draft takes the
// others' source sentences; the others are `merged` into it.
export const mergeSuggestions = transactional(async function mergeSuggestions(
  ctx: Context,
  captureId: string,
  input: z.output<typeof MergeSuggestions>,
) {
  assertCaptureAccess(ctx.user, await repo.selectCapture(ctx.db, captureId));
  const mergeIds = input.mergeIds.filter((mergeId) => mergeId !== input.keepId);
  if (!mergeIds.length) throw new AppError('validation_failed', { field: 'mergeIds' });
  const rows: Row[] = [];
  for (const suggestionId of [input.keepId, ...mergeIds])
    rows.push(await visibleSuggestion(ctx, suggestionId));
  const [kept, ...others] = rows;
  if (!kept) throw new AppError('not_found', { entityType: 'capture' });
  for (const row of rows) {
    if (row.captureId !== captureId) throw new AppError('not_found', { entityType: 'capture' });
    requirePending(row);
  }
  if (others.some((row) => row.kind !== kept.kind))
    throw new AppError('rule_violation', { reason: 'kind' });
  for (const row of others)
    await repo.updateSuggestion(ctx.db, row.id, { status: 'merged', mergeTargetId: kept.id });
  await repo.updateSuggestion(ctx.db, kept.id, {
    sourceSpans: [...kept.sourceSpans, ...others.flatMap((row) => row.sourceSpans)].slice(0, 50),
    revision: kept.revision + 1,
  });
  await writeAudit(ctx.db, ctx.user.id, 'merge', 'capture_suggestion', kept.id, {
    merged: others.map((row) => row.id),
  });
  return reread(ctx, kept.id);
});
