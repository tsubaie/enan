import 'server-only';
import { desc, eq, and, getTableColumns } from 'drizzle-orm';
import { auditLog, jobs, users } from './system-schema';
import { type Database } from './client';
// ADMIN-B43: the newest hundred changes, each with the name of the member who made it (null for a
// change the system made on its own, or by a member since removed).
export function auditEntries(database: Database) {
  return database
    .select({ ...getTableColumns(auditLog), actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(desc(auditLog.createdAt))
    .limit(100);
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
