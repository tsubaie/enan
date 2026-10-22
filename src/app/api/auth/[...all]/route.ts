import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/core/auth/better-auth';
import { withWriteLock } from '@/core/db/client';
// ADR 0055: sign-in, sign-out, codes and Google, all Better Auth's, under /api/auth. Its writes go
// through the pool, so they take their turn in the write queue (ADR 0029): one that met an open
// transaction would wait in the driver, blocking the whole process, and then fail busy.
const handle = (request: Request) => withWriteLock(async () => (await auth()).handler(request));
export const { GET, POST } = toNextJsHandler(handle);
