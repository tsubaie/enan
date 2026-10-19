import 'server-only';
import { access, writeFile, rm, mkdir } from 'node:fs/promises';
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
