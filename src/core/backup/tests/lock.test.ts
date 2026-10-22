import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { releaseStaleLock, withBackupLock } from '../maintenance';
import { createBackup } from '../dump';
import { names, workspace, writeTree } from './fixtures/archive';
const config = vi.hoisted(() => ({ BACKUP_DIR: '', FILES_DIR: '' }));
vi.mock('@/core/config/env', () => ({ env: () => config }));
let space: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
  space = await workspace();
  Object.assign(config, { BACKUP_DIR: space.backups, FILES_DIR: space.files });
});
afterEach(() => space.dispose());
const leftBy = (pid: number) => writeTree(space.backups, { '.lock': String(pid) });
it('ADMIN-B31 one backup or restore at a time: a second is refused while the first runs, then admitted', async () => {
  const inner = await withBackupLock(async () => withBackupLock(async () => 'second'));
  expect(inner).toEqual({ acquired: true, value: { acquired: false } });
  expect(await withBackupLock(async () => 'later')).toEqual({ acquired: true, value: 'later' });
});
it('ADMIN-B31 a lock held by a live process refuses a backup', async () => {
  await leftBy(process.ppid);
  await expect(createBackup(crypto.randomUUID())).rejects.toThrow('restore or another backup');
  expect((await withBackupLock(async () => 'blocked')).acquired).toBe(false);
});
it('ADMIN-B31 a lock left by a process that died, or by this process before a restart, is taken over', async () => {
  await leftBy(2 ** 22 + 1);
  expect((await withBackupLock(async () => 'dead holder')).acquired).toBe(true);
  // A restarted container runs the server as the same pid again; it holds nothing yet.
  await leftBy(process.pid);
  expect((await withBackupLock(async () => 'own pid')).acquired).toBe(true);
});
it('ADMIN-B31 the server removes at start a lock its own pid left, so a restore command is admitted', async () => {
  await leftBy(process.pid);
  await releaseStaleLock();
  await expect(names(space.backups)).resolves.not.toContain('.lock');
  // Another process's lock is left alone.
  await leftBy(process.ppid);
  await releaseStaleLock();
  await expect(names(space.backups)).resolves.toContain('.lock');
});
