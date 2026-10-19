import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '../client';
import { migrateDatabase } from '../migrate';
import { countQueries } from '../query-log';
beforeAll(async () => {
  await migrateDatabase();
});
afterAll(() => closeDatabase());
it('counts every statement issued through the client, including inside a transaction', async () => {
  const { queries } = await countQueries(async () => {
    await withTransaction(db(), async (database) => {
      for (let index = 0; index < 7; index += 1) await database.all(sql`select ${index}`);
      await database.transaction(async (inner) => {
        await inner.all(sql`select 'savepoint'`);
      });
    });
  });
  expect(queries).toBe(8);
  const { queries: none } = await countQueries(async () => undefined);
  expect(none).toBe(0);
});
