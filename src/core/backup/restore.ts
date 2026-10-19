import 'server-only';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { env } from '@/core/config/env';
import { defaults } from '@/core/config/defaults';
import { withSessionLock } from '@/core/db/locks';
import { activateDatabase, databaseFile, stageDatabase } from './database';
import { verifyBackup } from './manifest';
import { isRestoring, maintenanceFile } from './maintenance';
import { extractBounded } from './extract';
import { clearStaleStaging, stagingPrefix, swapInto } from './swap';
// Resource limits for a restore (docs/02-architecture.md § Resource limits). Expanded bytes are
// further capped by FILES_QUOTA_GB and by the archive's own verified size.
export const restoreLimits = { maxEntries: 200_000, deadlineMs: 60 * 60 * 1000 };
export type RestoreOptions = {
  confirmed: boolean;
  signal?: AbortSignal;
  limits?: Partial<typeof restoreLimits>;
};
/**
 * ADMIN-B31 the database is restored before any live file changes, and files are swapped in only
 * after the database file has been renamed into place. Maintenance mode is cleared on every exit
 * except two: when the database has been swapped but the files could not be moved into place,
 * and when the marker was already on because an earlier restore did not finish. Both stay in
 * maintenance until a restore succeeds, so the app never serves a database and files from
 * different backups. Restores are serialized, so one never clears another's staging or marker.
 * ADMIN-B32 the archive's declared sizes are verified and extraction is bounded.
 * ADMIN-B33 every phase before the database swap observes the caller's signal and the deadline.
 */
export async function restoreBackup(directory: string, options: RestoreOptions) {
  if (!options.confirmed) throw new Error('Restore replaces current data. Supply --confirm.');
  const limits = { ...restoreLimits, ...options.limits };
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(limits.deadlineMs),
  ]);
  const source = resolve(directory);
  const manifest = await verifyBackup(source, signal);
  const lock = await withSessionLock(defaults.restoreLock, () =>
    activate(source, manifest.files['files.tar'].bytes, limits, signal),
  );
  if (!lock.acquired) throw new Error('Another restore is already running.');
}
// The file swap retires every live entry of FILES_DIR; a database kept inside it would go too.
function assertDatabaseOutside(root: string) {
  const inside = relative(resolve(root), databaseFile());
  if (inside && !inside.startsWith('..') && !isAbsolute(inside))
    throw new Error('DATABASE_URL must not name a file inside FILES_DIR');
}
async function activate(
  source: string,
  archiveBytes: number,
  limits: typeof restoreLimits,
  signal: AbortSignal,
) {
  const root = env().FILES_DIR;
  await mkdir(root, { recursive: true });
  assertDatabaseOutside(root);
  await clearStaleStaging(root);
  const data = dirname(databaseFile());
  await mkdir(data, { recursive: true });
  await clearStaleStaging(data);
  const staging = join(root, `${stagingPrefix}${crypto.randomUUID()}`);
  const quota = env().FILES_QUOTA_GB * 1024 ** 3;
  // Under the lock no other restore runs, so a marker already present was left by a restore that
  // did not finish, and the database may no longer match the live files.
  const recovering = await isRestoring();
  let phase: 'files' | 'committed' | 'done' = 'files';
  let incoming: string | undefined;
  await maintenanceFile(true);
  try {
    await mkdir(staging);
    await extractBounded(
      join(source, 'files.tar'),
      staging,
      { maxEntries: limits.maxEntries, maxBytes: Math.min(quota, archiveBytes) },
      signal,
    );
    incoming = await stageDatabase(join(source, 'db.sqlite'), signal);
    signal.throwIfAborted();
    await activateDatabase(incoming);
    incoming = undefined;
    phase = 'committed';
    // The database is in place; the swap is not abandoned half way on a late signal.
    await swapInto(root, staging);
    phase = 'done';
  } catch (error) {
    if (phase === 'committed' || recovering)
      throw new Error(
        'The restore stopped after the database may already have changed, so the app stays in maintenance mode. Run the restore again with the same backup.',
        { cause: error },
      );
    throw error;
  } finally {
    // An aborted extraction (a limit, the deadline) can still be finishing a file it had started,
    // and tar signals no end after an abort; retry instead of letting ENOTEMPTY replace the error.
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (incoming) await rm(incoming, { force: true });
    if (phase === 'done' || (phase === 'files' && !recovering)) await maintenanceFile(false);
  }
}
