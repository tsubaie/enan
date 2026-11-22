import { z } from 'zod';
import { defineHandler, authenticated } from '@/core/http/handler';
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
} from './schema/validation';
import * as service from './service';
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
export const create = defineHandler({
  guard: 'session',
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
