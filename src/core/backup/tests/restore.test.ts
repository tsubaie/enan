import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { users } from '@/core/db/system-schema';
import { closeDatabase, databaseFor, pool, type DatabaseClient } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { createBackup } from '../dump';
import { restoreBackup } from '../restore';
import { maintenanceFile, isRestoring } from '../maintenance';
import { swapInto } from '../swap';
import { verifyBackup } from '../manifest';
import {
  appendTo,
  exists,
  makeBackup,
  makeLegacyBackup,
  names,
  newerDatabase,
  plainDatabase,
  rawTar,
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
// The database step of a restore (verify, migrate the staged copy) and the live client's close,
// wrapped so a test can observe, hold, fail or skip them.
const hooks = vi.hoisted(() => ({
  migrate: <T>(real: () => Promise<T>): Promise<T> => real(),
  close: (real: () => void) => real(),
}));
// When set, moving a staged entry into FILES_DIR fails, as a full or read-only volume would.
const activation = vi.hoisted(() => ({ fail: false, root: '' }));
vi.mock('@/core/config/env', () => ({ env: () => config }));
vi.mock('@/core/db/client', async (original) => {
  const actual = await original<typeof import('@/core/db/client')>();
  return { ...actual, closeDatabase: () => hooks.close(actual.closeDatabase) };
});
vi.mock('@/core/db/migrate', async (original) => {
  const actual = await original<typeof import('@/core/db/migrate')>();
  return {
    ...actual,
    migrateDatabase: (source?: DatabaseClient) =>
      hooks.migrate(() => actual.migrateDatabase(source)),
  };
});
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (activation.fail && from.startsWith(join(activation.root, '.restore-')))
        throw new Error('EIO: rename failed');
      return fs.rename(from, to);
    },
  };
});
let space: Awaited<ReturnType<typeof workspace>>;
const live = { 'old.txt': 'live', 'nested/keep.txt': 'live too' };
beforeEach(async () => {
  space = await workspace();
  Object.assign(config, {
    DATABASE_URL: `file:${join(space.root, 'data', 'live_test.db')}`,
    FILES_DIR: space.files,
    BACKUP_DIR: space.backups,
    FILES_QUOTA_GB: 20,
  });
  await writeTree(space.files, live);
  hooks.migrate = (real) => real();
  hooks.close = (real) => real();
  activation.fail = false;
  activation.root = space.files;
});
afterEach(async () => {
  hooks.close = (real) => real();
  closeDatabase();
  await space.dispose();
});
const source = () => join(space.root, 'source');
const good = () =>
  rawTar([
    { name: './', type: '5' },
    { name: './new.txt', body: 'restored' },
  ]);
const emails = async () =>
  (await databaseFor(pool()).select({ email: users.email }).from(users).orderBy(users.email)).map(
    (row) => row.email,
  );
const addUser = (email: string) =>
  databaseFor(pool())
    .insert(users)
    .values({ id: crypto.randomUUID(), email, name: email, passwordHash: 'x', role: 'admin' });
// The data directory without the WAL siblings an open client keeps beside the file.
const dataDir = async () =>
  (await names(join(space.root, 'data'))).filter((name) => !/-(?:wal|shm)$/u.test(name));
async function expectUntouched() {
  expect(await readTree(space.files)).toEqual(live);
  expect(await names(space.files)).toEqual(['nested', 'old.txt']);
  expect(await isRestoring()).toBe(false);
}
// Counts the database steps that run, leaving them otherwise untouched.
function countDatabaseSteps() {
  const seen = { count: 0 };
  hooks.migrate = (real) => {
    seen.count += 1;
    return real();
  };
  return seen;
}
// Holds the database step until released, so another restore can be attempted meanwhile.
function holdDatabaseStep() {
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const inRestore = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  hooks.migrate = async (real) => {
    entered();
    await held;
    return real();
  };
  return { inRestore, release: () => release() };
}
describe('restore sequence', () => {
  it('ADMIN-B31 swaps files in only after the database file is in place, and leaves no workspace behind', async () => {
    await makeBackup(source(), good());
    let seenDuringRestore: Record<string, string> = {};
    let databaseSeen = false;
    hooks.migrate = async (real) => {
      seenDuringRestore = await readTree(space.files);
      databaseSeen = await isRestoring();
      return real();
    };
    await restoreBackup(source(), { confirmed: true });
    expect(databaseSeen).toBe(true);
    expect(seenDuringRestore['old.txt']).toBe('live');
    expect(Object.values(seenDuringRestore)).toContain('restored');
    expect(await readTree(space.files)).toEqual({ 'new.txt': 'restored' });
    expect(await names(space.files)).toEqual(['new.txt']);
    expect(await dataDir()).toEqual(['live_test.db']);
    expect(await isRestoring()).toBe(false);
  });
  it('ADMIN-B31 a database that fails its checks leaves live files and the live database untouched and clears maintenance', async () => {
    await migrateDatabase(pool());
    await addUser('live@example.test');
    const cases: [string, Buffer, RegExp][] = [
      ['not a database', Buffer.from('not a database at all'), /database/u],
      ['no ledger', await plainDatabase(), /migrations ledger/u],
      ['a newer release', await newerDatabase(), /newer version/u],
    ];
    for (const [, database, message] of cases) {
      await makeBackup(source(), good(), database);
      await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow(message);
      await expectUntouched();
      expect(await emails()).toEqual(['live@example.test']);
    }
  });
  it('ADMIN-B31 a migration failure on the staged copy leaves the live database untouched', async () => {
    await migrateDatabase(pool());
    await addUser('live@example.test');
    await makeBackup(source(), good());
    hooks.migrate = () => Promise.reject(new Error('migration failed'));
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow('migration failed');
    await expectUntouched();
    expect(await emails()).toEqual(['live@example.test']);
    expect(await dataDir()).toEqual(['live_test.db']);
  });
  it('ADMIN-B31 refuses without confirmation and clears maintenance idempotently', async () => {
    await makeBackup(source(), good());
    await expect(restoreBackup(source(), { confirmed: false })).rejects.toThrow('--confirm');
    await maintenanceFile(false);
    await maintenanceFile(false);
    await expectUntouched();
  });
  it('ADMIN-B31 a restore is refused while a backup or another restore holds the lock, and changes nothing', async () => {
    await makeBackup(source(), good());
    // Held by a live process other than this one: the server writing a backup, say.
    await writeTree(space.backups, { '.lock': String(process.ppid) });
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow('already running');
    expect(await isRestoring()).toBe(false);
    await expectUntouched();
  });
  it('ADMIN-B31 refuses a backup from before ADR 0029 by name', async () => {
    await makeLegacyBackup(source());
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow('db.dump');
    await expectUntouched();
  });
  it('ADMIN-B31 a failed swap moves every live file back', async () => {
    await expect(swapInto(space.files, join(space.files, '.restore-missing'))).rejects.toThrow();
    expect(await readTree(space.files)).toEqual(live);
    expect(await names(space.files)).toEqual(['nested', 'old.txt']);
  });
  it('ADMIN-B31 a file swap that fails after the database swap keeps maintenance on until a rerun succeeds', async () => {
    await makeBackup(source(), good());
    activation.fail = true;
    const migrations = countDatabaseSteps();
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow(
      'Run the restore again',
    );
    expect(migrations.count).toBe(1);
    expect(await isRestoring()).toBe(true);
    expect(await readTree(space.files)).toEqual(live);
    activation.fail = false;
    await restoreBackup(source(), { confirmed: true });
    expect(await readTree(space.files)).toEqual({ 'new.txt': 'restored' });
    expect(await names(space.files)).toEqual(['new.txt']);
    expect(await isRestoring()).toBe(false);
  });
  it('ADMIN-B31 a rerun that fails before its own commit keeps the maintenance an unfinished restore left', async () => {
    await makeBackup(source(), good());
    activation.fail = true;
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow(
      'Run the restore again',
    );
    activation.fail = false;
    hooks.migrate = () => Promise.reject(new Error('migration failed'));
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow(
      'Run the restore again',
    );
    expect(await isRestoring()).toBe(true);
    hooks.migrate = (real) => real();
    await restoreBackup(source(), { confirmed: true });
    expect(await readTree(space.files)).toEqual({ 'new.txt': 'restored' });
    expect(await isRestoring()).toBe(false);
  });
  it('ADMIN-B31 a second restore is refused while one runs, and touches neither its staging nor maintenance', async () => {
    await makeBackup(source(), good());
    const hold = holdDatabaseStep();
    const first = restoreBackup(source(), { confirmed: true });
    await hold.inRestore;
    const staging = (await names(space.files)).filter((name) => name.startsWith('.restore-'));
    expect(staging).toHaveLength(1);
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow(
      'already running',
    );
    expect(await isRestoring()).toBe(true);
    expect(await names(space.files)).toEqual(expect.arrayContaining(staging));
    hold.release();
    await first;
    expect(await readTree(space.files)).toEqual({ 'new.txt': 'restored' });
    expect(await isRestoring()).toBe(false);
  });
  it('ADMIN-B31 stale staging from an interrupted restore is cleared, beside the files and beside the database', async () => {
    await writeTree(space.files, { '.restore-stale/leftover.txt': 'x' });
    await writeTree(join(space.root, 'data'), { '.restore-stale.db': 'x' });
    await makeBackup(source(), good());
    await restoreBackup(source(), { confirmed: true });
    expect(await names(space.files)).toEqual(['new.txt']);
    expect(await dataDir()).toEqual(['live_test.db']);
  });
  it('ADMIN-B31 refuses to restore when the database file lives inside FILES_DIR', async () => {
    config.DATABASE_URL = `file:${join(space.files, 'inside_test.db')}`;
    await makeBackup(source(), good());
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow('inside FILES_DIR');
    expect(await readTree(space.files)).toEqual(live);
  });
});
describe('a client that predates the restore', () => {
  it('ADMIN-B38 a process still holding the old file reopens on its next maintenance check', async () => {
    await migrateDatabase(pool());
    await addUser('kept@example.test');
    const id = crypto.randomUUID();
    await createBackup(id);
    await addUser('later@example.test');
    expect(await isRestoring()).toBe(false);
    // The application process keeps its client open while the command, in another process, swaps
    // the file: here the swap runs with the close skipped, which leaves this client on the old
    // file exactly as the server would be. The query makes sure the client is open beforehand.
    expect(await emails()).toEqual(['kept@example.test', 'later@example.test']);
    hooks.close = () => undefined;
    await restoreBackup(join(space.backups, id), { confirmed: true });
    expect(await emails()).toEqual(['kept@example.test', 'later@example.test']);
    hooks.close = (real) => real();
    expect(await isRestoring()).toBe(false);
    expect(await emails()).toEqual(['kept@example.test']);
    expect(await isRestoring()).toBe(false);
    expect(await emails()).toEqual(['kept@example.test']);
  });
});
describe('archive validation and limits', () => {
  const refused: [string, Buffer, RegExp][] = [
    [
      'a path escaping the staging directory',
      rawTar([{ name: '../escape.txt', body: 'x' }]),
      /\.\./u,
    ],
    ['an absolute path', rawTar([{ name: '/tmp/absolute.txt', body: 'x' }]), /absolute|\//u],
    [
      'a symbolic link',
      rawTar([{ name: 'link', type: '2', linkname: '/etc/passwd' }]),
      /SymbolicLink/u,
    ],
    ['a hard link', rawTar([{ name: 'hard', type: '1', linkname: 'old.txt' }]), /Link/u],
    [
      'a truncated entry declaring more bytes than it holds',
      rawTar([{ name: 'big.bin', body: 'short', declaredSize: 4096 }]),
      /./u,
    ],
  ];
  it.each(refused)('ADMIN-B32 refuses %s and changes nothing', async (_label, archive, message) => {
    await makeBackup(source(), archive);
    const migrations = countDatabaseSteps();
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow(message);
    expect(migrations.count).toBe(0);
    await expectUntouched();
    expect(await exists(join(space.root, 'escape.txt'))).toBe(false);
  });
  it('ADMIN-B32 stops at the entry-count limit', async () => {
    const many = rawTar(['a', 'b', 'c', 'd'].map((name) => ({ name, body: name })));
    await makeBackup(source(), many);
    await expect(
      restoreBackup(source(), { confirmed: true, limits: { maxEntries: 2 } }),
    ).rejects.toThrow('too many entries');
    await expectUntouched();
  });
  it('ADMIN-B32 stops when expanded bytes exceed the storage quota', async () => {
    config.FILES_QUOTA_GB = 100 / 1024 ** 3;
    await makeBackup(source(), rawTar([{ name: 'large.bin', body: 'x'.repeat(500) }]));
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow(
      'beyond the allowed size',
    );
    await expectUntouched();
  });
  it('ADMIN-B32 an archive whose size differs from the manifest is refused before activation', async () => {
    await makeBackup(source(), good());
    await appendTo(join(source(), 'files.tar'), 'tail');
    await expect(verifyBackup(source())).rejects.toThrow('size mismatch');
    await rewriteManifest(source(), (value) => {
      const tar = value.files['files.tar'];
      if (tar) tar.bytes += 4;
    });
    await expect(verifyBackup(source())).rejects.toThrow('checksum mismatch');
    await expect(restoreBackup(source(), { confirmed: true })).rejects.toThrow('mismatch');
    await expectUntouched();
  });
});
describe('interruption', () => {
  it('ADMIN-B33 the deadline aborts a slow phase and restores nothing', async () => {
    await makeBackup(source(), good());
    hooks.migrate = async (real) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return real();
    };
    await expect(
      restoreBackup(source(), { confirmed: true, limits: { deadlineMs: 50 } }),
    ).rejects.toThrow();
    await expectUntouched();
    expect(await dataDir()).toEqual([]);
  });
  it('ADMIN-B33 an aborted caller signal stops the restore before any change', async () => {
    await makeBackup(source(), good());
    const controller = new AbortController();
    controller.abort(new Error('Restore interrupted by SIGINT'));
    const migrations = countDatabaseSteps();
    await expect(
      restoreBackup(source(), { confirmed: true, signal: controller.signal }),
    ).rejects.toThrow();
    expect(migrations.count).toBe(0);
    await expectUntouched();
  });
});
