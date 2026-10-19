import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { users } from '@/core/db/system-schema';
import { closeDatabase, databaseFor, pool } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { createBackup } from '../dump';
import { isRestoring } from '../maintenance';
import { swapByHand, workspace } from './fixtures/archive';
// This file's module instance has never run a maintenance check before the swap below, which is
// the state of an application process that booted, opened its client, and was then restored from
// another process without serving a request in between.
const config = vi.hoisted(() => ({
  NODE_ENV: 'test',
  DATABASE_URL: '',
  FILES_DIR: '',
  BACKUP_DIR: '',
  FILES_QUOTA_GB: 20,
}));
vi.mock('@/core/config/env', () => ({ env: () => config }));
let space: Awaited<ReturnType<typeof workspace>>;
const livePath = () => join(space.root, 'data', 'live_test.db');
const emails = async () =>
  (await databaseFor(pool()).select({ email: users.email }).from(users).orderBy(users.email)).map(
    (row) => row.email,
  );
const addUser = (email: string) =>
  databaseFor(pool())
    .insert(users)
    .values({ id: crypto.randomUUID(), email, name: email, passwordHash: 'x', role: 'admin' });
beforeEach(async () => {
  space = await workspace();
  Object.assign(config, {
    DATABASE_URL: `file:${livePath()}`,
    FILES_DIR: space.files,
    BACKUP_DIR: space.backups,
  });
  await migrateDatabase(pool());
});
afterEach(async () => {
  closeDatabase();
  await space.dispose();
});
it('ADMIN-B38 a client opened before a restore in another process reopens on its first maintenance check', async () => {
  await addUser('kept@example.test');
  const id = crypto.randomUUID();
  await createBackup(id);
  await addUser('later@example.test');
  const stale = pool();
  await swapByHand(join(space.backups, id, 'db.sqlite'), livePath(), 4242);
  expect(await emails()).toEqual(['kept@example.test', 'later@example.test']);
  expect(await isRestoring()).toBe(false);
  expect(pool()).not.toBe(stale);
  expect(await emails()).toEqual(['kept@example.test']);
  // Settled: later checks keep the client.
  const reopened = pool();
  expect(await isRestoring()).toBe(false);
  expect(pool()).toBe(reopened);
});
