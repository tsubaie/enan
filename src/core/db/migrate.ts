import 'server-only';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { databaseFor, pool, withWriteLock, type DatabaseClient } from './client';
import { serialized } from './locks';
import { defaults } from '@/core/config/defaults';

// The migrator applies every pending file inside one transaction on one borrowed connection
// (foreign keys off for the duration, as a table rebuild needs). Concurrent callers in this
// process queue on the migration lock; a second process is excluded by ADR 0003.
export async function migrateDatabase(source: DatabaseClient = pool()) {
  await source.primed;
  await serialized(defaults.migrationLock, () =>
    withWriteLock(() => migrate(databaseFor(source), { migrationsFolder: './drizzle' })),
  );
}
