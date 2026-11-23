import { z } from 'zod';
import { defineHandler, authenticated } from '@/core/http/handler';
import { AppError } from '@/core/http/errors';
import { currentUser } from '@/core/auth/session';
import { voiceAudioLimits } from '@/core/files/voice-audio';
import { audioResponse } from '@/core/http/audio-response';
import {
  CaptureCount,
  CaptureCreate,
  CaptureGroup,
  CaptureList,
  CaptureListQuery,
  CaptureTranscript,
  Approval,
  ApproveReady,
  MergeSuggestions,
  Suggestion,
  SuggestionPatch,
  SuggestionRevision,
  UndoBatch,
} from './schema/validation';
import * as service from './service';
import * as review from './review/service';
import { requireRecording } from './setup';
// CAPTURES-B02: session guard, then the module's own visibility check inside every service call;
// the admin guard would hide a draft from its recorder.
const captureId = (params: Record<string, string>) => z.uuid().parse(params.id);
const response = z.object({ data: CaptureGroup });
export const count = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: z.object({ data: CaptureCount }),
  handler: async (_, ctx) => ({ data: await service.pendingCaptureCount(authenticated(ctx)) }),
});
export const list = defineHandler({
  guard: 'session',
  input: CaptureListQuery,
  source: 'query',
  response: CaptureList,
  handler: async (input, ctx) => service.listCaptures(authenticated(ctx), input),
});
export const detail = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response,
  handler: async (_, ctx, params) => ({
    data: await service.getCapture(authenticated(ctx), captureId(params)),
  }),
});
// CAPTURES-B01 CAPTURES-B12: the audio is checked and stored before the capture's own short
// transaction (ADR 0054); the declared body may exceed the audio by the multipart framing.
// CAPTURES-B14: with recording off it is refused before the body is read. Nothing else here is.
export const create = defineHandler({
  guard: 'session',
  before: requireRecording,
  input: CaptureCreate,
  source: 'form',
  maxBytes: () => voiceAudioLimits.maxBytes + 128 * 1024,
  status: 201,
  response,
  transaction: false,
  enqueues: true,
  handler: async (input, ctx) => ({
    data: await service.createCapture(authenticated(ctx), input),
  }),
});
export const transcript = defineHandler({
  guard: 'session',
  input: CaptureTranscript,
  response,
  // CAPTURES-B23: the transcript and its interpretation commit separately (service), so the route
  // holds no transaction of its own around them.
  transaction: false,
  enqueues: true,
  handler: async (input, ctx, params) => ({
    data: await service.typeTranscript(authenticated(ctx), captureId(params), input),
  }),
});
export const transcribe = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response,
  idempotent: true,
  enqueues: true,
  handler: async (_, ctx, params) => ({
    data: await service.retryTranscription(authenticated(ctx), captureId(params)),
  }),
});
export const interpret = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response,
  idempotent: true,
  enqueues: true,
  handler: async (_, ctx, params) => ({
    data: await service.retryInterpretation(authenticated(ctx), captureId(params)),
  }),
});
export const remove = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  status: 204,
  response: z.object({ opId: z.uuid() }),
  idempotent: true,
  handler: (_, ctx, params) => service.removeCapture(authenticated(ctx), captureId(params)),
});
export const restore = defineHandler({
  guard: 'session',
  input: z.strictObject({ opId: z.uuid() }),
  response,
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await service.restoreCapture(authenticated(ctx), captureId(params), input.opId),
  }),
});
// The audio is a file, not JSON, so it is answered here rather than through defineHandler, with
// the voice memo's Range handling. Unlike a memo's, it is only for the recorder and admins, and
// anyone else gets the same 404 as a missing id (CAPTURES-B02).
export async function audio(request: Request, route: { params: Promise<Record<string, string>> }) {
  const user = await currentUser({ slide: false });
  if (!user) return Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  const params = await route.params;
  const file = await service.captureAudio(user, params.id ?? '');
  if (!file) return Response.json({ error: { code: 'not_found' } }, { status: 404 });
  return audioResponse(request, file, 'private, no-store');
}

// CAPTURES-B10 CAPTURES-B11: reviewing drafts. The same session guard and visibility check; a
// draft is addressed by its own id, and its capture's recorder or an admin is the only reader.
const suggestionId = (params: Record<string, string>) => z.uuid().parse(params.id);
const suggestion = z.object({ data: Suggestion });
export const patchSuggestion = defineHandler({
  guard: 'session',
  input: SuggestionPatch,
  response: suggestion,
  handler: async (input, ctx, params) => ({
    data: await review.patchSuggestion(authenticated(ctx), suggestionId(params), input),
  }),
});
export const approve = defineHandler({
  guard: 'session',
  input: SuggestionRevision,
  response: z.object({ data: Approval }),
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await review.approveSuggestion(authenticated(ctx), suggestionId(params), input.revision),
  }),
});
export const approveReady = defineHandler({
  guard: 'session',
  input: ApproveReady,
  response: z.object({ data: z.object({ approved: z.array(Approval) }) }),
  idempotent: true,
  handler: async (input, ctx) => ({
    data: await review.approveReady(authenticated(ctx), input),
  }),
});
export const discard = defineHandler({
  guard: 'session',
  input: SuggestionRevision,
  response: suggestion,
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await review.discardSuggestion(authenticated(ctx), suggestionId(params), input.revision),
  }),
});
export const undo = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: suggestion,
  idempotent: true,
  handler: async (_, ctx, params) => {
    const [undone] = await review.undoSuggestions(authenticated(ctx), [suggestionId(params)]);
    if (!undone) throw new AppError('internal');
    return { data: undone };
  },
});
// §9 decision 10: an Approve N ready batch is undone whole or not at all.
export const undoBatch = defineHandler({
  guard: 'session',
  input: UndoBatch,
  response: z.object({ data: z.array(Suggestion) }),
  idempotent: true,
  handler: async (input, ctx) => ({
    data: await review.undoSuggestions(authenticated(ctx), input.ids),
  }),
});
export const merge = defineHandler({
  guard: 'session',
  input: MergeSuggestions,
  response: suggestion,
  idempotent: true,
  handler: async (input, ctx, params) => ({
    data: await review.mergeSuggestions(authenticated(ctx), captureId(params), input),
  }),
});
