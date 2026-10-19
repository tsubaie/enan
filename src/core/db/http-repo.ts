import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { idempotencyKeys, workspace } from './system-schema';
import { type Database } from './client';
import type { z } from 'zod';
// The replay lookup needs no lock of its own (ADR 0029): the handler opens an immediate
// transaction, so a retry of the same key waits at BEGIN until the first attempt has committed its
// stored response, then finds it here.
export async function replayRequest(database: Database, userId: string, key: string) {
  const [row] = await database
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.key, key),
        gt(idempotencyKeys.createdAt, new Date(Date.now() - 86400000)),
      ),
    );
  return row;
}
export async function storeRequest(
  database: Database,
  userId: string,
  key: string,
  requestHash: string,
  status: number,
  body: z.infer<ReturnType<typeof z.json>>,
) {
  await database
    .insert(idempotencyKeys)
    .values({ userId, key, requestHash, status, body })
    .onConflictDoUpdate({
      target: [idempotencyKeys.userId, idempotencyKeys.key],
      set: { requestHash, status, body, createdAt: new Date() },
    });
}
export async function maintenance(database: Database) {
  const [row] = await database.select({ enabled: workspace.maintenanceMode }).from(workspace);
  return row?.enabled ?? false;
}
