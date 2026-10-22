import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { users } from '@/core/db/system-schema';
import { authSessions } from '@/core/db/auth-schema';
import { id } from '@/core/db/ids';
import { selectUsers, countAdmins, updateUser } from '../repo';
import { addSession, addUser, harness } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
const actor = () => {
  if (!harness.user) throw new Error('harness not reset');
  return harness.user;
};
const patchOf = (user: { name: string; role: string; isActive: boolean; revision: number }) => ({
  name: user.name,
  role: user.role,
  isActive: user.isActive,
  revision: user.revision,
});
const liveSessions = (userId: string) =>
  db().select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, userId));
it('ADMIN-B03 the member list is every live account ordered by name and never a deleted one', async () => {
  const zed = await addUser('member', 'zed@example.test', { name: 'Zed' });
  await addUser('member', 'amal@example.test', { name: 'Amal' });
  const gone = await addUser('member', 'gone@example.test', { name: 'Gone' });
  await db()
    .update(users)
    .set({ deletedAt: new Date(), deletedOpId: id() })
    .where(eq(users.id, gone.id));
  const listed = await selectUsers(db());
  expect(listed.map((row) => row.name)).toEqual(['Amal', 'Workspace Administrator', 'Zed']);
  expect(listed.find((row) => row.id === zed.id)?.passwordHash).toBeDefined();
  expect(listed.some((row) => row.id === gone.id)).toBe(false);
});
it('ADMIN-B04 the admin count is of active, undeleted administrators only', async () => {
  expect(await countAdmins(db())).toBe(1);
  await addUser('member', 'member@example.test');
  const inactive = await addUser('admin', 'inactive@example.test', { isActive: false });
  const deleted = await addUser('admin', 'deleted@example.test');
  await db()
    .update(users)
    .set({ deletedAt: new Date(), deletedOpId: id() })
    .where(eq(users.id, deleted.id));
  expect(await countAdmins(db())).toBe(1);
  await db().update(users).set({ isActive: true }).where(eq(users.id, inactive.id));
  expect(await countAdmins(db())).toBe(2);
});
it('ADMIN-B03 an edit is applied against the revision it was read at and bumps it', async () => {
  const member = await addUser('member', 'member@example.test', { name: 'Before' });
  const stale = await updateUser(
    db(),
    member.id,
    { ...patchOf(member), name: 'Lost', revision: member.revision + 1 },
    actor().id,
  );
  expect(stale).toBeUndefined();
  const [untouched] = await db().select().from(users).where(eq(users.id, member.id));
  expect(untouched).toMatchObject({ name: 'Before', revision: member.revision });
  const row = await updateUser(
    db(),
    member.id,
    { ...patchOf(member), name: 'After', role: 'admin' },
    actor().id,
  );
  expect(row).toMatchObject({
    name: 'After',
    role: 'admin',
    revision: member.revision + 1,
    updatedBy: actor().id,
  });
  expect(await updateUser(db(), id(), patchOf(member), actor().id)).toBeUndefined();
});
it('ADMIN-B03 deactivating an account revokes every session of that account and no other', async () => {
  const member = await addUser('member', 'member@example.test');
  const bystander = await addUser('member', 'bystander@example.test');
  await addSession(member.id);
  await addSession(member.id);
  await addSession(bystander.id);
  // A rename keeps the sessions: only deactivation signs the account out.
  await updateUser(db(), member.id, { ...patchOf(member), name: 'Renamed' }, actor().id);
  expect(await liveSessions(member.id)).toHaveLength(2);
  const row = await updateUser(
    db(),
    member.id,
    { ...patchOf(member), name: 'Renamed', isActive: false, revision: member.revision + 1 },
    actor().id,
  );
  expect(row?.isActive).toBe(false);
  expect(await liveSessions(member.id)).toHaveLength(0);
  expect(await liveSessions(bystander.id)).toHaveLength(1);
  // A stale deactivation changes nothing, sessions included.
  await updateUser(
    db(),
    bystander.id,
    { ...patchOf(bystander), isActive: false, revision: 99 },
    actor().id,
  );
  expect(await liveSessions(bystander.id)).toHaveLength(1);
});
