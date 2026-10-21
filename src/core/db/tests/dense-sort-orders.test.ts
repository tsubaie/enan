import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { asc, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { closeDatabase, db } from '../client';
import { migrateDatabase } from '../migrate';
import { clearDatabase } from '../reset';
import { objectives } from '@/modules/kpis/schema/db';
import journal from '../../../../drizzle/meta/_journal.json';
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
// Runs one migration's statements again, on rows written the way the old reorder left them.
async function rerun(tag: string) {
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  const migration = readMigrationFiles({ migrationsFolder: './drizzle' })[index];
  for (const statement of migration?.sql ?? []) await db().run(sql.raw(statement));
}
it('COMM-B04 KPIS-B27 two rows on one place are renumbered once, keeping the order they showed in', async () => {
  const row = (id: string, name: string, sortOrder: number) => ({ id, name, sortOrder });
  await db()
    .insert(objectives)
    .values([
      row('00000000-0000-7000-8000-000000000003', 'Third', 2),
      row('00000000-0000-7000-8000-000000000001', 'First', 0),
      row('00000000-0000-7000-8000-000000000002', 'Tied, earlier id', 2),
      row('00000000-0000-7000-8000-000000000004', 'Last', 7),
    ]);
  await rerun('0005_dense_sort_orders');
  const after = await db().select().from(objectives).orderBy(asc(objectives.sortOrder));
  expect(after.map((item) => [item.name, item.sortOrder])).toEqual([
    ['First', 0],
    ['Tied, earlier id', 1],
    ['Third', 2],
    ['Last', 3],
  ]);
});
