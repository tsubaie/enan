import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/core/auth/better-auth';
import { id } from '@/core/db/ids';
import { inMaintenance } from '@/core/http/handler';
// ADR 0055: sign-in, sign-out, codes and Google, all Better Auth's, under /api/auth. Its writes
// take their turn in the write queue at the adapter (queuedWrites), not around the whole request.
// ADMIN-B13: during maintenance it answers 503 like every other API route.
const handle = async (request: Request) =>
  (await inMaintenance())
    ? Response.json({ error: { code: 'maintenance', requestId: id() } }, { status: 503 })
    : (await auth()).handler(request);
export const { GET, POST } = toNextJsHandler(handle);
