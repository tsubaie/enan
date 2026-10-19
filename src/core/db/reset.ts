import 'server-only';
import { basename } from 'node:path';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@/core/config/env';
import { databaseFor, pool, type DatabaseClient } from './client';
import { migrateDatabase } from './migrate';
const Objects = z.array(z.object({ type: z.string(), name: z.string() }));
const Files = z.array(z.object({ name: z.string(), file: z.string() }));
function quoted(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}
/**
 * Empties the file and migrates it again. Every user object in `sqlite_master` is dropped on one
 * connection with foreign keys off (a pragma cannot change inside a transaction, and dropping a
 * parent table with children present would otherwise fail), triggers and indexes go with their
 * tables, and the migrations ledger goes too so the migrator starts from nothing. Deleting the
 * file would not do: the open pool keeps the unlinked inode.
 */
export async function resetDatabase(source: DatabaseClient = pool()) {
  if (env().NODE_ENV === 'production') throw new Error('Reset is development-only');
  await source.primed;
  const database = databaseFor(source);
  const objects = Objects.parse(
    await database.all(
      sql`select type, name from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%'`,
    ),
  );
  const drops = objects.map((object) => `drop ${object.type} if exists ${quoted(object.name)}`);
  await source.executeMultiple(
    ['pragma foreign_keys = off', ...drops, 'pragma foreign_keys = on'].join('; '),
  );
  await migrateDatabase(source);
}
// Test support, the `truncate … cascade` of PostgreSQL days: every row of every user table goes,
// on one connection with foreign keys off so the order does not matter. The schema stays.
export async function clearDatabase(source: DatabaseClient = pool()) {
  if (env().NODE_ENV === 'production') throw new Error('Clearing is development-only');
  await source.primed;
  const tables = Objects.parse(
    await databaseFor(source).all(
      sql`select type, name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations'`,
    ),
  );
  const deletes = tables.map((table) => `delete from ${quoted(table.name)}`);
  await source.executeMultiple(
    ['pragma foreign_keys = off', ...deletes, 'pragma foreign_keys = on'].join('; '),
  );
}
/**
 * Browser runs start from an empty workspace, but only on a disposable database: a file whose
 * basename ends in `_test.db`, as the connection itself reports it. Any other file (a developer's
 * own, or a deployment's) is left exactly as it is. Production refuses through resetDatabase.
 */
export async function resetDisposableDatabase(source: DatabaseClient = pool()) {
  const files = Files.parse(await databaseFor(source).all(sql`pragma database_list`));
  const name = basename(files.find((entry) => entry.name === 'main')?.file ?? '');
  if (!name.endsWith('_test.db')) return { name, reset: false };
  await resetDatabase(source);
  return { name, reset: true };
}
