import { z } from 'zod';
import { defineHandler, authenticated } from '@/core/http/handler';
import { Capture, CaptureCount } from './schema/validation';
import { getCapture, pendingCaptureCount } from './service';
// CAPTURES-B02: session guard, then the module's own visibility check; the admin guard would hide
// a draft from its recorder. No route exports these yet: the capture routes arrive with recording.
export const count = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: z.object({ data: CaptureCount }),
  handler: async (_, ctx) => ({ data: await pendingCaptureCount(authenticated(ctx)) }),
});
export const detail = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: z.object({ data: Capture }),
  handler: async (_, ctx, params) => ({
    data: await getCapture(authenticated(ctx), z.uuid().parse(params.id)),
  }),
});
