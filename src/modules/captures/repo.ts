import 'server-only';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/core/db/client';
import { captures, captureSuggestions } from './schema/db';
export type CaptureRow = typeof captures.$inferSelect;
type Reader = { id: string; role: string };
// CAPTURES-B02: the captures a reader may see. One predicate for single reads, lists and counts,
// so no path can widen it: the recorder's own live captures, or any live capture for an admin.
export function visibleCaptures(user: Reader): SQL {
  const live = isNull(captures.deletedAt);
  return (user.role === 'admin' ? live : and(live, eq(captures.createdBy, user.id))) ?? live;
}
export async function selectCapture(database: Database, captureId: string) {
  const [row] = await database.select().from(captures).where(eq(captures.id, captureId));
  return row;
}
// The review badge (§ Behaviors, CAPTURES-B02): the reader's own pending drafts plus own failed
// captures, admins included, always inside the visibility predicate.
export async function countPendingCaptures(database: Database, user: Reader) {
  const [row] = await database
    .select({
      pending: sql<number>`coalesce(sum(case when ${captureSuggestions.status} = 'pending' then 1 else 0 end), 0)`,
      failed: sql<number>`count(distinct case when ${captures.status} = 'failed' then ${captures.id} end)`,
    })
    .from(captures)
    .leftJoin(
      captureSuggestions,
      and(eq(captureSuggestions.captureId, captures.id), isNull(captureSuggestions.deletedAt)),
    )
    .where(and(visibleCaptures(user), eq(captures.createdBy, user.id)));
  return Number(row?.pending ?? 0) + Number(row?.failed ?? 0);
}
