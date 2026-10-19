import { createHarness } from '@/core/db/test-harness';
import { db, withTransaction } from '@/core/db/client';
import { insertUser, insertSession, lockWorkspace } from '@/core/db/auth-repo';
import { digest, token } from '@/core/auth/password';
import { id } from '@/core/db/ids';
import { User } from '@/core/http/user-schema';
// Shared harness for the administration scenarios: a clean database and one administrator who is
// the actor of every change, so the audit trail and the last-admin count both have a known start.
export const harness = createHarness({
  name: 'Workspace Administrator',
  email: 'admin@example.test',
});
// A second account inserted the way setup and the service insert them, with a fixed password hash
// nobody logs in with. Deactivation and recovery scenarios add sessions to it to watch them go.
export function addUser(
  role: 'admin' | 'member',
  email: string,
  fields: { name?: string; isActive?: boolean; passwordHash?: string } = {},
) {
  return withTransaction(db(), async (database) => {
    await lockWorkspace(database);
    return User.parse(
      await insertUser(database, {
        id: id(),
        name: fields.name ?? email,
        email,
        passwordHash: fields.passwordHash ?? 'unused-test-hash',
        role,
        isActive: fields.isActive ?? true,
      }),
    );
  });
}
// One live session row for a user; returns the hash the sessions table holds.
export async function addSession(userId: string) {
  const raw = token();
  const now = new Date();
  await insertSession(db(), {
    id: id(),
    userId,
    tokenHash: digest(raw),
    issuedAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 3600000),
    absoluteExpiresAt: new Date(now.getTime() + 86400000),
  });
  return digest(raw);
}
