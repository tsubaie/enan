import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, db } from '../client';
import { migrateDatabase } from '../migrate';
import { clearDatabase } from '../reset';
import { id } from '../ids';
import { users, sessions } from '../system-schema';
import { tasks } from '@/modules/tasks/schema/db';
import {
  constraintViolation,
  isCheckViolation,
  isForeignKeyViolation,
  isTriggerViolation,
  isUniqueViolation,
} from '../errors';
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
const user = () => ({
  id: id(),
  email: 'one@example.test',
  name: 'One',
  passwordHash: 'x',
  role: 'admin',
});
async function failing(work: () => Promise<object>) {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error('expected the statement to fail');
}
it('maps a unique failure to its columns, through the Drizzle and libsql wrappers', async () => {
  await db().insert(users).values(user());
  const error = await failing(() => db().insert(users).values(user()));
  expect(constraintViolation(error)).toMatchObject({
    kind: 'unique',
    columns: ['users.email'],
    constraint: null,
  });
  expect(isUniqueViolation(error)).toBe(true);
  expect(isUniqueViolation(error, ['users.email'])).toBe(true);
  expect(isUniqueViolation(error, ['users.id'])).toBe(false);
  expect(isForeignKeyViolation(error)).toBe(false);
  // A primary key collision is a unique failure too (extended code PRIMARYKEY).
  const first = { ...user(), email: 'two@example.test' };
  await db().insert(users).values(first);
  const again = await failing(() =>
    db()
      .insert(users)
      .values({ ...first, email: 'three@example.test' }),
  );
  expect(isUniqueViolation(again, ['users.id'])).toBe(true);
});
it('maps foreign key, named CHECK and trigger failures, and leaves other errors alone', async () => {
  const now = new Date();
  const orphan = await failing(() =>
    db().insert(sessions).values({
      id: id(),
      userId: id(),
      tokenHash: 'h',
      issuedAt: now,
      lastSeenAt: now,
      expiresAt: now,
      absoluteExpiresAt: now,
    }),
  );
  expect(isForeignKeyViolation(orphan)).toBe(true);
  expect(constraintViolation(orphan)?.columns).toEqual([]);
  const role = await failing(() =>
    db()
      .insert(users)
      .values({ ...user(), role: 'owner' }),
  );
  expect(constraintViolation(role)).toMatchObject({
    kind: 'check',
    constraint: 'users_role_check',
  });
  expect(isCheckViolation(role, 'users_role_check')).toBe(true);
  expect(isCheckViolation(role, 'users_email_lower_check')).toBe(false);
  // TASKS-I01: the depth trigger raises its message, which arrives as the constraint text.
  const task = (parentId: string | null) => ({
    id: id(),
    title: 'T',
    sortOrder: 0,
    parentId,
    searchText: 't\n',
  });
  const parent = task(null);
  const child = task(parent.id);
  await db().insert(tasks).values([parent, child]);
  const grandchild = await failing(() => db().insert(tasks).values(task(child.id)));
  expect(constraintViolation(grandchild)).toMatchObject({
    kind: 'trigger',
    message: 'TASKS-I01 depth one required',
    constraint: 'TASKS-I01 depth one required',
  });
  expect(isTriggerViolation(grandchild, 'TASKS-I01')).toBe(true);
  expect(isTriggerViolation(grandchild, 'TASKS-I02')).toBe(false);
  expect(constraintViolation(new Error('plain'))).toBeNull();
  expect(constraintViolation('not an error')).toBeNull();
  expect(isUniqueViolation(undefined)).toBe(false);
});
