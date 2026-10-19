import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { env } from '@/core/config/env';
import { databaseFor, openClient, testPool, type DatabaseClient } from '../client';
import { databasePath, removeDatabaseFiles } from '../test-database';
import { resetDisposableDatabase } from '../reset';
// Every migration in the journal is applied exactly once.
import journal from '../../../../drizzle/meta/_journal.json';
// Test infrastructure, no product requirement: the browser suite's reset (scripts/db/e2e-reset.ts)
// must wipe only a `_test.db` file, rebuild it from the migrations, and refuse in production.
const mode = vi.hoisted(() => ({ production: false }));
vi.mock('@/core/config/env', async (original) => {
  const actual = await original<typeof import('@/core/config/env')>();
  return {
    ...actual,
    env: () => ({ ...actual.env(), ...(mode.production ? { NODE_ENV: 'production' } : {}) }),
  };
});
const disposable = testPool();
// A sibling file in the same directory whose name does not end in `_test.db`.
const keptPath = join(dirname(databasePath(env().DATABASE_URL)), 'executiveos_kept.db');
const kept = openClient(`file:${keptPath}`, 2);
async function marked(source: DatabaseClient) {
  const [row] = await databaseFor(source).all<{ present: number }>(
    sql`select count(*) as present from sqlite_master where type = 'table' and name = 'reset_marker'`,
  );
  return row?.present === 1;
}
async function mark(source: DatabaseClient) {
  await databaseFor(source).run(sql`create table if not exists reset_marker (id int)`);
}
beforeAll(async () => {
  await Promise.all([disposable.primed, kept.primed]);
});
beforeEach(() => {
  mode.production = false;
});
afterAll(async () => {
  disposable.close();
  kept.close();
  await removeDatabaseFiles(keptPath);
});
it('the browser reset refuses in production and changes nothing', async () => {
  await mark(disposable);
  mode.production = true;
  await expect(resetDisposableDatabase(disposable)).rejects.toThrow('development-only');
  expect(await marked(disposable)).toBe(true);
});
it('the browser reset wipes a _test.db file and rebuilds it from the migrations', async () => {
  await mark(disposable);
  const outcome = await resetDisposableDatabase(disposable);
  expect(outcome).toEqual({ name: expect.stringMatching(/_test\.db$/u), reset: true });
  expect(await marked(disposable)).toBe(false);
  const [users] = await databaseFor(disposable).all<{ present: number }>(
    sql`select count(*) as present from sqlite_master where type = 'table' and name = 'users'`,
  );
  expect(users?.present).toBe(1);
  const [migrations] = await databaseFor(disposable).all<{ n: number }>(
    sql`select count(*) as n from __drizzle_migrations`,
  );
  expect(migrations?.n).toBe(journal.entries.length);
});
it('the browser reset keeps any file whose name does not end in _test.db', async () => {
  await mark(kept);
  expect(await resetDisposableDatabase(kept)).toEqual({
    name: 'executiveos_kept.db',
    reset: false,
  });
  expect(await marked(kept)).toBe(true);
});
