import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction, type Database } from '../client';
import { id } from '../ids';
import { migrateDatabase } from '../migrate';
import { clearDatabase } from '../reset';
import { enqueue, queueCapacity } from '../jobs-repo';
import { jobs } from '../system-schema';
import { transactional } from '../transaction';
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(async () => {
  await clearDatabase();
});
afterAll(() => closeDatabase());
const queued = async () => (await db().select({ n: count() }).from(jobs))[0]?.n ?? 0;
// Plain inserts, so the atomicity contract is proven by the transaction layer alone.
const insertJob = (database: Database, dedupKey: string) =>
  database.insert(jobs).values({ id: id(), kind: 'system.noop', payload: {}, dedupKey });
const twoWritesThenFail = transactional(async ({ db: database }: { db: Database }) => {
  await insertJob(database, 'first');
  await insertJob(database, 'second');
  throw new Error('injected after two writes');
});
it('ADMIN-B36 a service method called with the pool rolls back every write when a later step fails', async () => {
  await expect(twoWritesThenFail({ db: db() })).rejects.toThrow('injected');
  expect(await queued()).toBe(0);
});
it('ADMIN-B36 inside a request transaction a failed method rolls back only its own writes', async () => {
  await withTransaction(db(), async (outer) => {
    await insertJob(outer, 'before');
    await expect(twoWritesThenFail({ db: outer })).rejects.toThrow('injected');
    await insertJob(outer, 'after');
  });
  const keys = (await db().select({ key: jobs.dedupKey }).from(jobs)).map((row) => row.key).sort();
  expect(keys).toEqual(['after', 'before']);
});
it('ADMIN-B37 a full queue refuses with a retryable queue-scoped rate limit, not a server error', async () => {
  await withTransaction(db(), async (database) => {
    for (let index = 0; index < queueCapacity; index += 1)
      await enqueue(database, 'system.noop', {}, null);
  });
  await expect(enqueue(db(), 'system.noop', {}, null)).rejects.toMatchObject({
    code: 'rate_limited',
    details: { scope: 'queue', kind: 'system.noop', retryAfterSeconds: 30 },
  });
  expect(await queued()).toBe(queueCapacity);
  expect(await db().select().from(jobs).where(eq(jobs.kind, 'system.backup'))).toEqual([]);
});
