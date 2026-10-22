import 'server-only';
import { z } from 'zod';
import { defineHandler, authenticated } from '@/core/http/handler';
import { User, Recovery } from './validation';
import { recover } from './login';
import { clientIp } from '@/core/http/client-ip';
// ADR 0055: signing in and out is Better Auth's (/api/auth). What stays here is Enan's own: the
// recovery token (ADMIN-B02) and who the reader is.
export const recoveryApi = defineHandler({
  guard: 'public',
  input: Recovery,
  response: z.object({ data: z.null() }),
  handler: async (input, context, _params, request) => {
    await recover(context.db, input, clientIp(request));
    return { data: null };
  },
});
export const meApi = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: z.object({ data: User }),
  handler: async (_, ctx) => ({ data: authenticated(ctx).user }),
});
