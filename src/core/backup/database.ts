import 'server-only';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { z } from 'zod';
import { env } from '@/core/config/env';
import { closeDatabase, databaseFor, pool, type DatabaseClient } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { databasePath } from '@/core/db/test-database';
import { stagingPrefix } from './swap';
/**
 * The database side of backup and restore (ADR 0029). The backup is the file: `VACUUM INTO`
 * writes a consistent snapshot while the application keeps running, and a restore brings a
 * snapshot back by preparing a copy beside the live file and renaming it over the live path.
 * Every helper here works on paths; the live client is touched only to take the snapshot and to
 * close it before the swap.
 */
export const databaseFile = () => resolve(databasePath(env().DATABASE_URL));
const Integrity = z.array(z.object({ integrity_check: z.string() }));
const Ledger = z.tuple([z.object({ applied: z.number(), latest: z.number().nullable() })]);
const Version = z.tuple([z.object({ user_version: z.number() })]);
// A private single connection on a snapshot file, without the live client's pragmas: the file
// stays in rollback-journal mode, so everything written to it is in the file itself and no -wal
// sibling has to travel with it (libsql does not checkpoint on close).
export function openSnapshot(path: string): DatabaseClient {
  return Object.assign(createClient({ url: pathToFileURL(path).href, concurrency: 1 }), {
    primed: Promise.resolve(undefined),
    connections: 1,
  });
}
// ADMIN-B33: a consistent online snapshot of the live file. VACUUM INTO reads through its own
// connection, so committed WAL content is included and writers are not blocked; it cannot run
// inside a transaction, hence the client's own execute rather than withTransaction. The statement
// is not interruptible, so the signal is observed on either side of it.
export async function snapshotDatabase(target: string, signal: AbortSignal) {
  signal.throwIfAborted();
  await pool().execute({ sql: 'vacuum into ?', args: [target] });
  signal.throwIfAborted();
}
async function verifySnapshot(client: DatabaseClient) {
  const database = databaseFor(client);
  let integrity: z.infer<typeof Integrity>;
  try {
    integrity = Integrity.parse(await database.all(sql`pragma integrity_check`));
  } catch (error) {
    throw new Error('Backup database cannot be read as a SQLite database', { cause: error });
  }
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok')
    throw new Error(
      `Backup database failed integrity_check: ${integrity.map((row) => row.integrity_check).join('; ')}`,
    );
  let ledger: z.infer<typeof Ledger>[0];
  try {
    [ledger] = Ledger.parse(
      await database.all(
        sql`select count(*) as applied, max(created_at) as latest from __drizzle_migrations`,
      ),
    );
  } catch (error) {
    throw new Error('Backup database has no migrations ledger; it is not an Enan database', {
      cause: error,
    });
  }
  if (ledger.applied === 0 || ledger.latest === null)
    throw new Error('Backup database has an empty migrations ledger');
  const known = Math.max(
    ...readMigrationFiles({ migrationsFolder: './drizzle' }).map((file) => file.folderMillis),
  );
  if (ledger.latest > known)
    throw new Error(
      'Backup was created by a newer version of Enan; upgrade before restoring it',
    );
}
// A random stamp in the file header (`user_version`) that tells one restored file from another,
// so a client that predates a restore can be recognised (see reconcileDatabaseClient).
const generation = () => 1 + Math.floor(Math.random() * 0x7fff_fffe);
/**
 * ADMIN-B31: the backup's database is copied beside the live file (same filesystem, so the later
 * rename is atomic), verified with `PRAGMA integrity_check` and a look at its migrations ledger,
 * migrated to the current schema, and stamped. All of that happens on the copy: a backup that
 * fails any step, including a migration, leaves the live database exactly as it was.
 */
export async function stageDatabase(snapshot: string, signal: AbortSignal) {
  const incoming = join(dirname(databaseFile()), `${stagingPrefix}${crypto.randomUUID()}.db`);
  try {
    await pipeline(createReadStream(snapshot), createWriteStream(incoming), { signal });
    const client = openSnapshot(incoming);
    try {
      await verifySnapshot(client);
      signal.throwIfAborted();
      await migrateDatabase(client);
      await databaseFor(client).run(sql.raw(`pragma user_version = ${generation()}`));
    } finally {
      client.close();
    }
  } catch (error) {
    await rm(incoming, { force: true });
    throw error;
  }
  return incoming;
}
/**
 * The commit point of a restore. The live client is closed so this process holds nothing on the
 * old file; the old `-wal` and `-shm` go before the rename, because SQLite would otherwise replay
 * the old file's frames into the new one on its first open; then one rename makes the prepared
 * copy the live file. The copy is complete and closed before the rename, so a process that dies
 * right after it leaves a consistent database behind; the next `pool()` call opens it.
 */
export async function activateDatabase(incoming: string) {
  const live = databaseFile();
  closeDatabase();
  await rm(`${live}-wal`, { force: true });
  await rm(`${live}-shm`, { force: true });
  await rename(incoming, live);
}
async function identityOf(path: string) {
  try {
    const file = await stat(path);
    return `${file.dev}:${file.ino}`;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
async function generationOf(client: DatabaseClient) {
  const [row] = Version.parse(await databaseFor(client).all(sql`pragma user_version`));
  return row.user_version;
}
async function generationAt(path: string) {
  const client = openSnapshot(path);
  try {
    return await generationOf(client);
  } finally {
    client.close();
  }
}
// Once per process (every server chunk has its own copy of this module): a value per chunk made
// each chunk close the client once after a restore, a later one closing the freshly reopened pool.
declare global {
  var enanVerifiedDatabase: string | undefined;
}
/**
 * ADMIN-B38: the restore command runs in its own process, so the application's client keeps the
 * old file open after the swap until it is told. This check, run with every maintenance-mode
 * check while no restore is in progress, closes the client once the live path names a different
 * file from the one it was verified on; the next query reopens the new file. On the first look the
 * file's identity is unknown to this process, so the generation stamp in the header is compared
 * between the client and the path instead.
 */
export async function reconcileDatabaseClient() {
  const live = databaseFile();
  const identity = await identityOf(live);
  if (identity === undefined || identity === globalThis.enanVerifiedDatabase) return;
  if (
    globalThis.enanVerifiedDatabase === undefined &&
    (await generationAt(live)) === (await generationOf(pool()))
  ) {
    globalThis.enanVerifiedDatabase = identity;
    return;
  }
  closeDatabase();
  globalThis.enanVerifiedDatabase = identity;
}
