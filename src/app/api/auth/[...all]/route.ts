import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/core/auth/better-auth';
// ADR 0055: sign-in, sign-out, codes and Google, all Better Auth's, under /api/auth. Its writes
// take their turn in the write queue at the adapter (queuedWrites), not around the whole request.
const handle = async (request: Request) => (await auth()).handler(request);
export const { GET, POST } = toNextJsHandler(handle);
