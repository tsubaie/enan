import 'server-only';
import { eq, and, count, isNull } from 'drizzle-orm';
import { users } from '@/core/db/system-schema';
import { revokeUserSessions } from '@/core/db/auth-repo';
import type { Database } from '@/core/db/client';
import { updateEntity } from '@/core/db/entity';
export function selectUsers(database: Database) {
  return database.select().from(users).where(isNull(users.deletedAt)).orderBy(users.name);
}
export async function countAdmins(database: Database) {
  const [row] = await database
    .select({ count: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true), isNull(users.deletedAt)));
  return row?.count ?? 0;
}
// ADMIN-B59: who hears about updates.
export async function selectAdminIds(database: Database) {
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true), isNull(users.deletedAt)));
  return rows.map((row) => row.id);
}
export async function updateUser(
  database: Database,
  userId: string,
  patch: { name: string; role: string; isActive: boolean; revision: number },
  actorId: string,
) {
  const { revision, ...fields } = patch;
  const row = await updateEntity<typeof users.$inferSelect>(
    database,
    users,
    userId,
    revision,
    fields,
    actorId,
  );
  if (row && !patch.isActive) await revokeUserSessions(database, userId);
  return row;
}
