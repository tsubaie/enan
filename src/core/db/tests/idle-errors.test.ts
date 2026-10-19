import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createClient } from '@libsql/client';
import { env } from '@/core/config/env';
import { logger } from '@/core/config/logger';
import { closeDatabase, databaseFor, db, openClient } from '../client';
import { clearDatabase } from '../reset';
import { databasePath, removeDatabaseFiles, setDatabaseReadOnly } from '../test-database';
import { migrateDatabase } from '../migrate';
// ADMIN-B38: a database error outside a request's own statement is logged, not thrown, and the
// next query succeeds. With SQLite the errors outside a statement are the pool's own: setting up
// a pooled connection, here made to fail by a read-only file.
const readOnly = join(dirname(databasePath(env().DATABASE_URL)), 'readonly_pragmas_test.db');
beforeAll(async () => {
  await migrateDatabase();
  await clearDatabase();
  // Created without the pragmas, so the file is in rollback-journal mode and the switch to WAL
  // is a write the read-only file refuses.
  const seed = createClient({ url: `file:${readOnly}` });
  await seed.execute('create table if not exists marker (id integer)');
  seed.close();
  await setDatabaseReadOnly(readOnly, true);
});
afterEach(() => {
  closeDatabase();
});
afterAll(async () => {
  closeDatabase();
  await setDatabaseReadOnly(readOnly, false);
  await removeDatabaseFiles(readOnly);
});
it('ADMIN-B38 a failure while a pooled connection is set up is logged and the next query succeeds', async () => {
  const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  const client = openClient(`file:${readOnly}`, 2);
  try {
    await expect(client.primed).rejects.toMatchObject({ code: 'SQLITE_READONLY' });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.objectContaining({ code: 'SQLITE_READONLY' }) }),
        'Database pragmas failed',
      ),
    );
    expect(await databaseFor(client).get(sql`select count(*) as n from marker`)).toEqual({ n: 0 });
  } finally {
    client.close();
  }
});
it('ADMIN-B38 a statement that fails on one connection reaches only its caller; the pool keeps serving', async () => {
  await expect(db().run(sql`insert into no_such_table values (1)`)).rejects.toMatchObject({
    cause: { code: 'SQLITE_ERROR' },
  });
  await expect(
    db().run(
      sql`insert into users (id, email, name, password_hash, role) values ('x', 'A@B', 'n', 'p', 'admin')`,
    ),
  ).rejects.toMatchObject({ cause: { code: 'SQLITE_CONSTRAINT' } });
  const next = await Promise.all(Array.from({ length: 4 }, () => db().get(sql`select 1 as one`)));
  expect(next).toEqual([{ one: 1 }, { one: 1 }, { one: 1 }, { one: 1 }]);
});
