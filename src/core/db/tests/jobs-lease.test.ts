import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '../client';
import { migrateDatabase } from '../migrate';
import { clearDatabase } from '../reset';
import { jobs, jobAttempts } from '../system-schema';
import { busyTimeoutMs } from '../client';
import { claim, enqueue, fail, renew } from '../jobs-repo';
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
const kind = 'system.noop';
const enqueueWith = (key: string) =>
  withTransaction(db(), (database) => enqueue(database, kind, {}, key));
// A job claimed by a runner that then disappeared: running, its lease already past.
async function abandoned(key: string, attempt: number) {
  const job = await enqueueWith(key);
  await db()
    .update(jobs)
    .set({ attempt: attempt - 1 })
    .where(eq(jobs.id, job.id));
  const claimed = await claim('gone', kind, 1, 4);
  expect(claimed?.attempt).toBe(attempt);
  await db()
    .update(jobs)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(jobs.id, job.id));
  return job.id;
}
const stored = async (jobId: string) =>
  (await db().select().from(jobs).where(eq(jobs.id, jobId)))[0];
const attemptRow = async (jobId: string, attempt: number) =>
  (
    await db()
      .select()
      .from(jobAttempts)
      .where(and(eq(jobAttempts.jobId, jobId), eq(jobAttempts.attempt, attempt)))
  )[0];
it('ADMIN-B46 enqueue on the key of a running job whose lease expired requeues it while attempts remain and returns it', async () => {
  const jobId = await abandoned('backup', 1);
  const returned = await enqueueWith('backup');
  expect(returned.id).toBe(jobId);
  expect(returned.status).toBe('queued');
  expect(returned.leaseOwner).toBeNull();
  expect(await db().select().from(jobs)).toHaveLength(1);
  expect(await attemptRow(jobId, 1)).toMatchObject({ status: 'abandoned', error: 'lease_expired' });
});
it('ADMIN-B46 enqueue on the key of an expired job on its last attempt fails it with lease_expired and inserts a new job', async () => {
  const jobId = await abandoned('backup', 3);
  const returned = await enqueueWith('backup');
  expect(returned.id).not.toBe(jobId);
  expect(returned.status).toBe('queued');
  expect(await stored(jobId)).toMatchObject({ status: 'failed', lastError: 'lease_expired' });
  expect(await attemptRow(jobId, 3)).toMatchObject({ status: 'abandoned', error: 'lease_expired' });
});
it('ADMIN-B46 enqueue still returns a running job whose lease is live', async () => {
  const job = await enqueueWith('backup');
  await claim('alive', kind, 1, 4);
  const returned = await enqueueWith('backup');
  expect(returned).toMatchObject({ id: job.id, status: 'running', leaseOwner: 'alive' });
});
it('ADMIN-B46 the claim sweep fails a running job whose lease expired on its last attempt', async () => {
  const jobId = await abandoned('backup', 3);
  expect(await claim('next', kind, 1, 4)).toBeNull();
  expect(await stored(jobId)).toMatchObject({
    status: 'failed',
    lastError: 'lease_expired',
    leaseExpiresAt: null,
  });
  expect((await stored(jobId))?.finishedAt).toBeInstanceOf(Date);
  expect(await attemptRow(jobId, 3)).toMatchObject({ status: 'abandoned' });
});

it('ADR 0029 a heartbeat during a long write transaction waits its turn instead of failing busy', async () => {
  await enqueueWith('heartbeat');
  const job = await claim('runner', kind, 1, 4);
  if (!job) throw new Error('the job was not claimed');
  // A request holding the write lock for longer than the driver's busy timeout.
  let entered: () => void = () => {};
  const inside = new Promise<void>((resolve) => (entered = resolve));
  const holder = withTransaction(db(), async (database) => {
    await database.update(jobs).set({ leaseOwner: 'runner' }).where(eq(jobs.id, job.id));
    entered();
    await new Promise((done) => setTimeout(done, busyTimeoutMs + 500));
  });
  await inside;
  await expect(renew(job)).resolves.toBe(true);
  await holder;
});
it('NOTIF-B04 a failure effect runs once, when the job has failed for good, not on an attempt that will retry', async () => {
  const job = await enqueueWith('finishing');
  await db().update(jobs).set({ maxAttempts: 2 }).where(eq(jobs.id, job.id));
  const finals: string[] = [];
  const effect = async () => {
    finals.push('told');
  };
  const first = await claim('runner', kind, 1, 4);
  if (!first) throw new Error('not claimed');
  await fail(first, 'boom', true, undefined, effect);
  expect(finals).toEqual([]);
  await db()
    .update(jobs)
    .set({ runAfter: new Date(0) })
    .where(eq(jobs.id, job.id));
  const second = await claim('runner', kind, 1, 4);
  if (!second) throw new Error('not claimed again');
  await fail(second, 'boom', true, undefined, effect);
  expect(finals).toEqual(['told']);
  expect((await stored(job.id))?.status).toBe('failed');
});
