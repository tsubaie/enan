import type { Context } from '@/core/auth/session';
import { createTask } from '@/modules/tasks';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { SuggestedTask } from './schema/validation';
import { z } from 'zod';
import { defineHandler, authenticated } from '@/core/http/handler';
import { AppError } from '@/core/http/errors';
import { getSetting } from '@/core/db/settings-repo';
import { currentUser } from '@/core/auth/session';
import { audioResponse } from '@/core/http/audio-response';
import { voiceAudioLimits } from '@/core/files/voice-audio';
import { startNoteAi } from './ai/service';
import { noteAiApplyHandler, noteAiDiscardHandler, noteAiRestoreHandler } from './ai/api';
import {
  NoteDetail,
  NoteCreate,
  NotePatch,
  NoteList,
  NoteListQuery,
  Revision,
  BulkItems,
  BulkTag,
  BulkResult,
  TagList,
  NoteTypes,
  NoteTemplates,
  VoiceCreate,
  VoiceTranscribe,
} from './schema/validation';
import * as service from './service';
import * as voice from './voice/service';
import { listManagedTags, manageTags } from './service';
import { ManageTags, ManageTagsResult } from './schema/validation';
export const managedTags = defineHandler({
  guard: 'admin',
  input: z.strictObject({}),
  response: TagList,
  handler: (_, ctx) => listManagedTags(authenticated(ctx)),
});
export const manageTagSelection = defineHandler({
  guard: 'admin',
  input: ManageTags,
  response: ManageTagsResult,
  idempotent: true,
  handler: (input, ctx) => manageTags(authenticated(ctx), input),
});
const noteId = (params: Record<string, string>) => z.uuid().parse(params.id);
const response = z.object({ data: NoteDetail });
export const list = defineHandler({
  guard: 'session',
  input: NoteListQuery,
  response: NoteList,
  handler: (input, ctx) => service.listNotes(authenticated(ctx), input),
});
export const create = defineHandler({
  guard: 'session',
  input: NoteCreate,
  response,
  status: 201,
  idempotent: true,
  handler: async (input, ctx) => ({ data: await service.createNote(authenticated(ctx), input) }),
});
export const detail = defineHandler({
  guard: 'session',
  input: z.strictObject({ includeDeleted: z.enum(['true', 'false']).optional() }),
  response,
  handler: async (input, ctx, params) => ({
    data: await service.getNote(
      authenticated(ctx),
      noteId(params),
      input.includeDeleted === 'true',
    ),
  }),
});
export const patch = defineHandler({
  guard: 'session',
  input: NotePatch,
  response,
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await service.patchNote(authenticated(ctx), noteId(params), input),
  }),
});
export const remove = defineHandler({
  guard: 'session',
  input: Revision,
  response: z.object({ opId: z.uuid() }),
  status: 204,
  handler: (input, ctx, params) =>
    service.removeNote(authenticated(ctx), noteId(params), input.revision),
});
export const restore = defineHandler({
  guard: 'session',
  input: z.strictObject({ opId: z.uuid() }),
  response,
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await service.restoreNote(authenticated(ctx), noteId(params), input.opId),
  }),
});
export const archive = defineHandler({
  guard: 'session',
  input: Revision,
  response,
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await service.archiveNote(authenticated(ctx), noteId(params), input.revision),
  }),
});
export const unarchive = defineHandler({
  guard: 'session',
  input: Revision,
  response,
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await service.unarchiveNote(authenticated(ctx), noteId(params), input.revision),
  }),
});
export const bulkArchive = defineHandler({
  guard: 'session',
  input: BulkItems,
  response: BulkResult,
  idempotent: true,
  handler: (input, ctx) => service.bulkArchive(authenticated(ctx), input),
});
export const bulkTag = defineHandler({
  guard: 'session',
  input: BulkTag,
  response: BulkResult,
  idempotent: true,
  handler: (input, ctx) => service.bulkTag(authenticated(ctx), input),
});
export const types = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: NoteTypes,
  handler: (_input, ctx) => service.listTypes(authenticated(ctx)),
});
export const templates = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: NoteTemplates,
  handler: (_input, ctx) => service.listTemplates(authenticated(ctx)),
});
export const tags = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: TagList,
  handler: (_input, ctx) => service.listTags(authenticated(ctx)),
});
function noteAiStart(capability: 'notes.refine' | 'notes.suggest_tags') {
  return defineHandler({
    guard: 'session',
    input: Revision,
    response: z.object({ data: z.object({ id: z.uuid() }) }),
    status: 202,
    enqueues: true,
    handler: async (input, ctx, params) => ({
      data: await startNoteAi(authenticated(ctx), noteId(params), input.revision, capability),
    }),
  });
}
export const refine = noteAiStart('notes.refine');
export const suggestTags = noteAiStart('notes.suggest_tags');
export const refineApply = noteAiApplyHandler('notes.refine', createSuggestedTask);
export const tagsApply = noteAiApplyHandler('notes.suggest_tags', createSuggestedTask);
export const refineDiscard = noteAiDiscardHandler('notes.refine');
export const refineRestore = noteAiRestoreHandler();
export const tagsDiscard = noteAiDiscardHandler('notes.suggest_tags');

// NOTES-B29–B32: voice memos. New audio arrives as a voice capture (CAPTURES-B07, ADR 0071):
// attaching a recording to a note is gone for good, and record-first note creation answers 410
// unless the `captures.inbox` safety hatch is off. Existing memos keep playback, removal and
// their transcript (CAPTURES-B06).
const memoId = (params: Record<string, string>) => z.uuid().parse(params.memoId);
const retired = () => new AppError('gone', { reason: 'retired', use: '/api/v1/captures' });
// The body is never read, so no audio reaches the disk.
export const voiceUpload = defineHandler({
  guard: 'session',
  input: z.object({}),
  source: 'query',
  response,
  transaction: false,
  handler: async () => {
    throw retired();
  },
});
// NOTES-B36, retired: with the inbox off (rollback only), a recording becomes a new note again,
// still without attaching to an existing note and without a self-applying rewrite.
export const voiceCreate = defineHandler({
  guard: 'session',
  input: VoiceCreate,
  source: 'form',
  maxBytes: () => voiceAudioLimits.maxBytes + 128 * 1024,
  status: 201,
  response,
  transaction: false,
  enqueues: true,
  // The setting is read before the body, so with the inbox on nothing is parsed or buffered.
  before: async (ctx) => {
    if (await getSetting(ctx.db, 'captures.inbox')) throw retired();
  },
  handler: async (input, ctx) => ({
    data: await voice.createNoteFromVoice(authenticated(ctx), input),
  }),
});
export const voiceRemove = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response,
  idempotent: true,
  handler: async (_input, ctx, params) => ({
    data: await voice.removeVoiceMemo(authenticated(ctx), noteId(params), memoId(params)),
  }),
});
// `refine` starts the note's refinement on the content as the append left it, in the same
// transaction, so a refused start leaves the transcript out of the note too.
export const voiceTranscribe = defineHandler({
  guard: 'session',
  input: VoiceTranscribe,
  response,
  idempotent: true,
  enqueues: true,
  handler: async (input, ctx, params) => {
    const context = authenticated(ctx);
    if (input.ai)
      return { data: await voice.transcribeWithAi(context, noteId(params), memoId(params)) };
    const note = await voice.transcribeVoiceMemo(context, noteId(params), memoId(params), input);
    if (!input.refine) return { data: note };
    await startNoteAi(context, note.id, note.revision, 'notes.refine');
    return { data: await service.getNote(context, note.id) };
  },
});
// The audio is a file, not JSON, so it is answered here rather than through defineHandler. A
// memo's audio never changes, so the browser may keep it.
export async function voiceAudioFile(
  request: Request,
  route: { params: Promise<Record<string, string>> },
) {
  const user = await currentUser({ slide: false });
  if (!user) return Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  const params = await route.params;
  const audio = await voice.voiceMemoAudio(params.id ?? '', params.memoId ?? '');
  if (!audio) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  return audioResponse(request, audio, 'private, max-age=31536000, immutable');
}

async function createSuggestedTask(
  ctx: Context,
  noteId: string,
  task: z.infer<typeof SuggestedTask>,
  ownerId: string | null,
) {
  const row = await createTask(
    ctx,
    TaskCreate.parse({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.due_date,
      sourceNoteId: noteId,
      ownerId,
    }),
  );
  return row.id;
}
