import 'server-only';
import {
  desc,
  eq,
  and,
  getTableColumns,
  gte,
  inArray,
  like,
  lt,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
import { AuditChange, changeWords } from '@/core/config/audit-schema';
import { auditLog, jobs, users } from './system-schema';
import { type Database } from './client';
export type AuditFilter = { entityTypes?: string[]; change?: AuditChange; from?: Date; to?: Date };
// ADMIN-B43: the newest hundred changes, each with the name of the member who made it (null for a
// change the system made on its own, or by a member since removed). ADMIN-B72, ADMIN-B73: narrowed
// by kind, by what was done and to a span of time, the hundred are the newest that match.
export function auditEntries(database: Database, filter: AuditFilter = {}) {
  return database
    .select({ ...getTableColumns(auditLog), actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(
      and(
        // ADMIN-B72: all entries means all changes; sign-ins are their own kind, so a busy morning
        // or a stranger's attempts never push changes out of view.
        filter.entityTypes
          ? inArray(auditLog.entityType, filter.entityTypes)
          : ne(auditLog.entityType, 'session'),
        filter.change ? didChange(filter.change) : undefined,
        filter.from ? gte(auditLog.createdAt, filter.from) : undefined,
        filter.to ? lt(auditLog.createdAt, filter.to) : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(100);
}
// An action does `change` when it holds one of its words and none of an earlier kind's.
function didChange(change: AuditChange) {
  const holds = (kind: AuditChange) =>
    or(...changeWords[kind].map((word) => like(auditLog.action, `%${word}%`))) ?? sql`false`;
  const earlier = AuditChange.options.slice(0, AuditChange.options.indexOf(change));
  return and(holds(change), ...earlier.map((kind) => not(holds(kind))));
}
export async function cancelJob(database: Database, id: string) {
  return database.update(jobs).set({ cancelRequested: true }).where(eq(jobs.id, id)).returning();
}
export async function readJob(database: Database, id: string) {
  const [row] = await database
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, id)));
  return row;
}
