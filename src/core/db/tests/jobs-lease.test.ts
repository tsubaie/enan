import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '../client';
import { migrateDatabase } from '../migrate';
import { clearDatabase } from '../reset';
import { jobs, jobAttempts } from '../system-schema';
import { busyTimeoutMs } from '../client';
import { claim, enqueue, fail, prune, renew } from '../jobs-repo';
import { activeKinds } from '../jobs-queue-repo';
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
it('ADR 0067 activeKinds names the kinds with a queued or running job, expired leases included, and nothing once they end', async () => {
  expect(await activeKinds()).toEqual([]);
  const jobId = await abandoned('backup', 1);
  await withTransaction(db(), (database) => enqueue(database, 'system.other', {}, null));
  expect((await activeKinds()).sort()).toEqual([kind, 'system.other']);
  const claimed = await claim('runner', kind, 1, 4);
  if (claimed?.id !== jobId) throw new Error('the abandoned job was not reclaimed');
  await fail(claimed, 'provider', false);
  expect(await activeKinds()).toEqual(['system.other']);
});
it('ADR 0067 a claim refused by the concurrency limit still sweeps a queued job whose cancel was requested', async () => {
  const running = await enqueueWith('first');
  expect((await claim('runner', kind, 1, 4))?.id).toBe(running.id);
  const waiting = await enqueueWith('second');
  await db().update(jobs).set({ cancelRequested: true }).where(eq(jobs.id, waiting.id));
  expect(await claim('runner', kind, 1, 4)).toBeNull();
  expect((await stored(waiting.id))?.status).toBe('cancelled');
});
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
it('ADMIN-B33 a job stopped by a shutdown on its last attempt is queued again with that attempt given back', async () => {
  const job = await enqueueWith('last-try');
  const maxAttempts = (await stored(job.id))?.maxAttempts ?? 1;
  await db()
    .update(jobs)
    .set({ attempt: maxAttempts - 1 })
    .where(eq(jobs.id, job.id));
  const claimed = await claim('runner', kind, 1, 4);
  if (!claimed) throw new Error('not claimed');
  expect(claimed.attempt).toBe(maxAttempts);
  await fail(claimed, 'shutdown', true);
  expect(await stored(job.id)).toMatchObject({ status: 'queued', attempt: maxAttempts - 1 });
  expect(await attemptRow(job.id, maxAttempts)).toBeUndefined();
  // The restarted runner claims it under the same attempt number.
  expect((await claim('restarted', kind, 1, 4))?.attempt).toBe(maxAttempts);
});
it('ADMIN-B12 the prune removes finished jobs past 30 days and their attempts, keeping the newest success of each kind', async () => {
  const day = 86400000;
  const finished = async (key: string, status: 'succeeded' | 'failed', daysAgo: number) => {
    const job = await enqueueWith(key);
    await claim('runner', kind, 1, 4);
    await db()
      .update(jobs)
      .set({ status, finishedAt: new Date(Date.now() - daysAgo * day), leaseExpiresAt: null })
      .where(eq(jobs.id, job.id));
    return job.id;
  };
  const oldest = await finished('a', 'succeeded', 90);
  const newestOld = await finished('b', 'succeeded', 60);
  const failed = await finished('c', 'failed', 45);
  const recent = await finished('d', 'failed', 3);
  const queued = (await enqueueWith('e')).id;
  await withTransaction(db(), (database) => prune(database));
  const left = (await db().select().from(jobs)).map((job) => job.id).sort();
  expect(left).toEqual([newestOld, recent, queued].sort());
  expect(await attemptRow(oldest, 1)).toBeUndefined();
  expect(await attemptRow(failed, 1)).toBeUndefined();
  expect(await attemptRow(newestOld, 1)).toBeDefined();
});
