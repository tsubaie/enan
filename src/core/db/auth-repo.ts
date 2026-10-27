import 'server-only';
import { and, eq, gt, ne, desc, sql, or } from 'drizzle-orm';
import { db, type Database } from './client';
import { users, workspace, loginAttempts, recoveryTokens } from './system-schema';
import { authAccounts, authPasskeys, authSessions } from './auth-schema';
import { id } from './ids';

export async function initialized(database: Database = db()) {
  const [row] = await database.select({ id: users.id }).from(users).limit(1);
  return Boolean(row);
}
// The singleton row, created on first use. The name is historical: it held a row lock under
// PostgreSQL, and now the caller's immediate transaction is the lock (ADR 0029), so every writer
// that reads it is already serialized against every other.
export async function lockWorkspace(database: Database) {
  await database.insert(workspace).values({ id: 1 }).onConflictDoNothing();
  const [row] = await database.select().from(workspace).where(eq(workspace.id, 1));
  if (!row) throw new Error('Workspace singleton missing');
  return row;
}
export async function setSetupToken(database: Database, setupTokenHash: string | null) {
  await database.update(workspace).set({ setupTokenHash }).where(eq(workspace.id, 1));
}
// ADMIN-B01: the spent token is replaced by a fingerprint of the whole submission for the replay
// window. It can only sign the new administrator back in, never create another, and bootstrap
// clears it on the next start.
export async function finishSetup(database: Database, replayHash: string) {
  await database
    .update(workspace)
    .set({ setupCompletedAt: new Date(), setupTokenHash: replayHash })
    .where(eq(workspace.id, 1));
}
export async function userByEmail(database: Database, email: string) {
  const [row] = await database
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));
  return row;
}
// Every member is added by an administrator, so the address counts as verified, and the password
// is written where Better Auth reads it (ADR 0055) as well as on the row.
export async function insertUser(database: Database, input: typeof users.$inferInsert) {
  const [row] = await database
    .insert(users)
    .values({ emailVerified: true, ...input })
    .returning();
  if (!row) throw new Error('User insert failed');
  await database.insert(authAccounts).values({
    id: id(),
    accountId: row.id,
    providerId: 'credential',
    userId: row.id,
    password: row.passwordHash,
  });
  return row;
}
// ADR 0055: ending a session deletes its row, which is how Better Auth knows it is over.
export async function revokeUserSessions(database: Database, userId: string) {
  await database.delete(authSessions).where(eq(authSessions.userId, userId));
}
// ADR 0055: Better Auth reads the password from the credential account. The copy on `users` is
// kept in step for the previous release (ADR 0050) and for the current-password checks.
export async function setPassword(database: Database, userId: string, passwordHash: string) {
  const now = new Date();
  await database
    .insert(authAccounts)
    .values({
      id: id(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
    })
    .onConflictDoUpdate({
      target: [authAccounts.providerId, authAccounts.accountId],
      set: { password: passwordHash, updatedAt: now },
    });
  await database
    .update(users)
    .set({
      passwordHash,
      passwordChangedAt: now,
      updatedAt: now,
      revision: sql`${users.revision}+1`,
    })
    .where(eq(users.id, userId));
}
// ADMIN-B20: the email and the client address are independent buckets, counted in one statement so
// the login path stays inside the per-request query budget. A null key counts nothing rather than
// matching every row: an address the deployment cannot resolve is not a bucket anyone shares.
export async function loginFailures(
  database: Database,
  email: string | null,
  address: string | null,
) {
  if (email === null && address === null) return { byEmail: 0, byAddress: 0 };
  const [row] = await database
    .select({
      byEmail: sql<number>`count(*) filter (where ${loginAttempts.email} = ${email})`.mapWith(
        Number,
      ),
      byAddress: sql<number>`count(*) filter (where ${loginAttempts.ip} = ${address})`.mapWith(
        Number,
      ),
    })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.succeeded, false),
        gt(loginAttempts.createdAt, new Date(Date.now() - 900000)),
        or(
          email === null ? undefined : eq(loginAttempts.email, email),
          address === null ? undefined : eq(loginAttempts.ip, address),
        ),
      ),
    );
  return { byEmail: row?.byEmail ?? 0, byAddress: row?.byAddress ?? 0 };
}
// An unresolved address and the recovery route's absent email are both stored as the empty string:
// the column is NOT NULL, and loginFailures only ever compares against a real key, so an empty
// value can never join a bucket.
export async function recordLogin(
  database: Database,
  email: string | null,
  ip: string | null,
  succeeded: boolean,
) {
  await database
    .insert(loginAttempts)
    .values({ id: id(), email: email ?? '', ip: ip ?? '', succeeded });
}
export async function usedRecovery(database: Database, hash: string) {
  const [row] = await database
    .select()
    .from(recoveryTokens)
    .where(eq(recoveryTokens.tokenHash, hash));
  return Boolean(row);
}
export async function recoverUser(
  database: Database,
  userId: string,
  hash: string,
  passwordHash: string,
) {
  await database.insert(recoveryTokens).values({ tokenHash: hash });
  await setPassword(database, userId, passwordHash);
  await revokeUserSessions(database, userId);
}
// A session row as Better Auth writes one; scenarios use it to stand sessions up without a sign-in.
export async function insertSession(database: Database, input: typeof authSessions.$inferInsert) {
  await database.insert(authSessions).values(input);
}
// ACCT-B03: the reader's own sessions that have not expired, most recently used first.
export async function userSessions(database: Database, userId: string) {
  return database
    .select({
      id: authSessions.id,
      issuedAt: authSessions.createdAt,
      lastSeenAt: authSessions.updatedAt,
      ip: authSessions.ipAddress,
      userAgent: authSessions.userAgent,
    })
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), gt(authSessions.expiresAt, new Date())))
    .orderBy(desc(authSessions.updatedAt));
}
// ACCT-B02/B03: ending everything the reader holds except the session making the request, so a
// password change signs them out everywhere else without signing them out of the tab they are in.
export async function revokeOtherSessions(database: Database, userId: string, keepId: string) {
  const rows = await database
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), ne(authSessions.id, keepId)))
    .returning({ id: authSessions.id });
  return rows.length;
}
// One session of the reader's own. Scoped by user so an id from elsewhere ends nothing.
export async function revokeOwnSession(database: Database, userId: string, sessionId: string) {
  const rows = await database
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), eq(authSessions.id, sessionId)))
    .returning({ id: authSessions.id });
  return rows.length > 0;
}
// ACCT-B01/B02: the account's own writes. `updatedAt` and the revision move with every change so
// the concurrency token the rest of the app uses keeps working here too.
export async function updateUserAccount(
  database: Database,
  userId: string,
  patch: Partial<typeof users.$inferInsert>,
) {
  const [row] = await database
    .update(users)
    .set({ ...patch, updatedAt: new Date(), updatedBy: userId })
    .where(eq(users.id, userId))
    .returning();
  return row;
}
// ACCT-B01: a Google account linked to the old address no longer signs in to this one.
export async function unlinkGoogle(database: Database, userId: string) {
  await database
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, 'google')));
}
export async function userById(database: Database, userId: string) {
  const [row] = await database.select().from(users).where(eq(users.id, userId));
  return row;
}
// ACCT-B10: the reader's passkeys, oldest first; the public key and credential id stay here.
export async function userPasskeys(database: Database, userId: string) {
  return database
    .select({
      id: authPasskeys.id,
      name: authPasskeys.name,
      deviceType: authPasskeys.deviceType,
      backedUp: authPasskeys.backedUp,
      createdAt: authPasskeys.createdAt,
      aaguid: authPasskeys.aaguid,
    })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, userId))
    .orderBy(authPasskeys.createdAt);
}
