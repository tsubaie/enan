import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { users } from '@/core/db/system-schema';
import { closeDatabase, databaseFor, pool, withTransaction } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { createBackup, listBackups, pruneBackups } from '../dump';
import { restoreBackup } from '../restore';
import { verifyBackup } from '../manifest';
import {
  archiveNames,
  names,
  readTree,
  rewriteManifest,
  workspace,
  writeTree,
} from './fixtures/archive';
const config = vi.hoisted(() => ({
  NODE_ENV: 'test',
  DATABASE_URL: '',
  FILES_DIR: '',
  BACKUP_DIR: '',
  FILES_QUOTA_GB: 20,
}));
// Wraps the live client's accessor so a test can act at the moment the snapshot is taken.
const hooks = vi.hoisted(() => ({ pool: <T>(real: () => T): T => real() }));
vi.mock('@/core/config/env', () => ({ env: () => config }));
vi.mock('@/core/db/client', async (original) => {
  const actual = await original<typeof import('@/core/db/client')>();
  return { ...actual, pool: () => hooks.pool(actual.pool) };
});
let space: Awaited<ReturnType<typeof workspace>>;
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
    DATABASE_URL: `file:${join(space.root, 'data', 'live_test.db')}`,
    FILES_DIR: space.files,
    BACKUP_DIR: space.backups,
  });
  hooks.pool = (real) => real();
  await writeTree(space.files, { 'doc.txt': 'document', '.restore-inflight/leak.txt': 'staged' });
  await migrateDatabase(pool());
});
afterEach(async () => {
  closeDatabase();
  await space.dispose();
});
it('ADMIN-B33 an aborted backup leaves no staging directory behind', async () => {
  const controller = new AbortController();
  hooks.pool = (real) => {
    controller.abort(new Error('shutdown'));
    return real();
  };
  const id = crypto.randomUUID();
  await expect(createBackup(id, controller.signal)).rejects.toThrow();
  expect(await names(space.backups)).toEqual([]);
});
it('ADMIN-B31 a backup never captures a restore workspace, and restores round-trip', async () => {
  await addUser('kept@example.test');
  const id = crypto.randomUUID();
  const manifest = await createBackup(id);
  expect(manifest.schemaVersion).toBe(2);
  expect(Object.keys(manifest.files).sort()).toEqual(['db.sqlite', 'files.tar']);
  const entries = await archiveNames(join(space.backups, id, 'files.tar'));
  expect(entries.some((name) => name.endsWith('doc.txt'))).toBe(true);
  expect(entries.some((name) => name.includes('.restore-'))).toBe(false);
  await writeTree(space.files, { 'later.txt': 'written after the backup' });
  await addUser('later@example.test');
  expect(await emails()).toEqual(['kept@example.test', 'later@example.test']);
  await restoreBackup(join(space.backups, id), { confirmed: true });
  expect(await readTree(space.files)).toEqual({ 'doc.txt': 'document' });
  expect(await emails()).toEqual(['kept@example.test']);
  // The restore worked on a copy: the backup itself still verifies and lists.
  expect((await verifyBackup(join(space.backups, id))).id).toBe(id);
  expect((await listBackups()).map((entry) => entry.id)).toEqual([id]);
  expect(await names(join(space.root, 'data'))).toEqual(
    expect.not.arrayContaining([expect.stringMatching(/^\.restore-/u)]),
  );
});
it('ADMIN-B33 a backup taken during a write is a consistent snapshot of committed data', async () => {
  await addUser('committed@example.test');
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = withTransaction(databaseFor(pool()), async (tx) => {
    await tx.insert(users).values({
      id: crypto.randomUUID(),
      email: 'uncommitted@example.test',
      name: 'n',
      passwordHash: 'x',
      role: 'admin',
    });
    await held;
  });
  const id = crypto.randomUUID();
  await createBackup(id);
  release();
  await writing;
  expect(await emails()).toEqual(['committed@example.test', 'uncommitted@example.test']);
  await restoreBackup(join(space.backups, id), { confirmed: true });
  expect(await emails()).toEqual(['committed@example.test']);
});
// Three backups a day apart, oldest first, so their order never depends on the clock's resolution.
async function threeBackups() {
  const ids = [];
  for (const day of [1, 2, 3]) {
    const id = crypto.randomUUID();
    await createBackup(id);
    await rewriteManifest(join(space.backups, id), (value) =>
      Object.assign(value, { createdAt: `2026-10-0${day}T00:00:00.000Z` }),
    );
    ids.push(id);
  }
  return ids;
}
it('ADMIN-B48 a backup count of 0 keeps every backup', async () => {
  const ids = await threeBackups();
  expect(await pruneBackups(0)).toEqual([]);
  expect([...(await names(space.backups))].sort()).toEqual([...ids].sort());
});
it('ADMIN-B12 ADMIN-B48 a backup count of N keeps the N newest backups and nothing else', async () => {
  const [oldest, middle, newest] = await threeBackups();
  await writeTree(join(space.backups, 'not-a-backup'), { 'notes.txt': 'kept' });
  expect(await pruneBackups(2)).toEqual([oldest]);
  expect((await listBackups()).map((entry) => entry.id)).toEqual([newest, middle]);
  expect([...(await names(space.backups))].sort()).toEqual([middle, newest, 'not-a-backup'].sort());
  expect(await pruneBackups(5)).toEqual([]);
});
