import 'server-only';
import { access, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@/core/config/env';
import { reconcileDatabaseClient } from './database';
async function markerPresent() {
  try {
    await access(join(env().BACKUP_DIR, '.maintenance'));
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
// The marker is the restore's own signal; while it is absent the check also makes sure this
// process's database client is on the file the live path names (a restore in another process may
// have swapped it), so the first request after a restore reads the restored data.
export async function isRestoring() {
  const restoring = await markerPresent();
  if (!restoring) await reconcileDatabaseClient();
  return restoring;
}
// ADMIN-B31: clearing is idempotent, so a restore's cleanup can never fail on a file that an
// earlier attempt or an operator already removed.
export async function maintenanceFile(enabled: boolean) {
  await mkdir(env().BACKUP_DIR, { recursive: true });
  const file = join(env().BACKUP_DIR, '.maintenance');
  if (enabled) await writeFile(file, new Date().toISOString());
  else await rm(file, { force: true });
}
// ADMIN-B31: one backup or restore at a time, across processes: the restore is a command of its
// own while backups run in the server. The lock file names its holder's pid; one left by a process
// that has died, or by this process before it restarted (pid 1 again in a container), is taken over.
let holding = false;
function alive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0 || (pid === process.pid && !holding)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
async function claim(file: string, retry = true): Promise<boolean> {
  try {
    await writeFile(file, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    const holder = Number(await readFile(file, 'utf8').catch(() => ''));
    if (!retry || alive(holder)) return false;
    await rm(file, { force: true });
    return claim(file, false);
  }
}
export async function withBackupLock<T>(
  work: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  await mkdir(env().BACKUP_DIR, { recursive: true });
  const file = join(env().BACKUP_DIR, '.lock');
  if (holding || !(await claim(file))) return { acquired: false };
  holding = true;
  try {
    return { acquired: true, value: await work() };
  } finally {
    holding = false;
    await rm(file, { force: true });
  }
}
