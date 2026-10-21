import 'server-only';
import { and, eq, gt, lte, isNull, or, sql, desc, count, inArray, lt } from 'drizzle-orm';
import {
  jobs,
  jobAttempts,
  schedules,
  loginAttempts,
  sessions,
  idempotencyKeys,
} from './system-schema';
import { db, withTransaction, type Database } from './client';
import { id } from './ids';
import type { z } from 'zod';
import { AppError } from '@/core/http/errors';
export type Claimed = typeof jobs.$inferSelect;
export const queueCapacity = 100;
export async function enqueue(
  database: Database,
  kind: string,
  payload: z.infer<ReturnType<typeof z.json>>,
  dedupKey: string | null,
  actorId: string | null = null,
) {
  // No lock of its own: the caller's immediate transaction serializes every enqueue (ADR 0029),
  // so the dedup read and the capacity count cannot interleave with another writer.
  const [existing] = dedupKey
    ? await database
        .select()
        .from(jobs)
        .where(and(eq(jobs.dedupKey, dedupKey), inArray(jobs.status, ['queued', 'running'])))
    : [];
  // ADMIN-B46: a running job whose lease expired has no live runner behind it (a crash, a restart,
  // or a database copied while it ran), so it is recovered here exactly as a claim would recover
  // it rather than answering every later request with it: back to the queue while attempts remain,
  // otherwise failed, which frees the dedup key for the new job below.
  const live = existing ? await recoverExpired(database, existing, new Date()) : null;
  if (live) return live;
  const [depth] = await database
    .select({ count: count() })
    .from(jobs)
    .where(and(eq(jobs.kind, kind), inArray(jobs.status, ['queued', 'running'])));
  // Queue overload is the caller's to retry later, never a server fault (04-api-conventions § errors).
  if ((depth?.count ?? 0) >= queueCapacity)
    throw new AppError('rate_limited', { scope: 'queue', kind, retryAfterSeconds: 30 });
  const [row] = await database
    .insert(jobs)
    .values({ id: id(), kind, payload, dedupKey, createdBy: actorId })
    .returning();
  if (!row) throw new Error('Job insert failed');
  return row;
}
export async function claim(owner: string, kind: string, concurrency: number, globalLimit: number) {
  // ADR 0010 leases and fencing on SQLite: the immediate transaction is the claim lock, so the
  // admission count, the sweep and the candidate read see one consistent queue (ADR 0029).
  return withTransaction(db(), async (database) => {
    const now = new Date();
    if (!(await admits(database, kind, concurrency, globalLimit, now))) return null;
    await sweepQueue(database, now);
    const candidate = await selectCandidate(database, kind, now);
    if (!candidate) return null;
    return writeClaim(database, candidate, owner, now);
  });
}
async function admits(
  database: Database,
  kind: string,
  concurrency: number,
  globalLimit: number,
  now: Date,
) {
  const active = await database
    .select({ kind: jobs.kind })
    .from(jobs)
    .where(and(eq(jobs.status, 'running'), gt(jobs.leaseExpiresAt, now)));
  return (
    active.length < globalLimit && active.filter((row) => row.kind === kind).length < concurrency
  );
}
async function sweepQueue(database: Database, now: Date) {
  await database
    .update(jobs)
    .set({ status: 'cancelled', finishedAt: now })
    .where(and(eq(jobs.status, 'queued'), eq(jobs.cancelRequested, true)));
  await database
    .update(jobs)
    .set({ status: 'failed', lastError: 'deadline_exceeded', finishedAt: now })
    .where(and(inArray(jobs.status, ['queued', 'running']), lte(jobs.deadlineAt, now)));
  // ADMIN-B46: a claim reclaims an expired lease only while attempts remain, so a job that lost its
  // lease on its last attempt is ended here instead of staying running, and holding its dedup
  // key, forever.
  const exhausted = await database
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, 'running'),
        lte(jobs.leaseExpiresAt, now),
        sql`${jobs.attempt} >= ${jobs.maxAttempts}`,
      ),
    );
  for (const job of exhausted) await recoverExpired(database, job, now);
}
// ADMIN-B46: the recovery a claim applies to a running job whose lease expired, made explicit so
// enqueue and the sweep can apply it without claiming. The abandoned attempt is closed; the job is
// queued again while attempts remain and failed with `lease_expired` once they are spent. Returns
// the job when it is still live (queued, or running under a valid lease), null when it ended.
async function recoverExpired(database: Database, job: Claimed, now: Date) {
  if (job.status !== 'running' || !job.leaseExpiresAt || job.leaseExpiresAt > now) return job;
  await database
    .update(jobAttempts)
    .set({ status: 'abandoned', finishedAt: now, error: 'lease_expired' })
    .where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attempt, job.attempt)));
  const retry = job.attempt < job.maxAttempts && !job.cancelRequested;
  const [row] = await database
    .update(jobs)
    .set(
      retry
        ? { status: 'queued', leaseOwner: null, leaseExpiresAt: null, runAfter: now }
        : {
            status: job.cancelRequested ? 'cancelled' : 'failed',
            lastError: 'lease_expired',
            leaseExpiresAt: null,
            finishedAt: now,
          },
    )
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running'), lte(jobs.leaseExpiresAt, now)))
    .returning();
  return retry ? (row ?? null) : null;
}
// The latest job of a kind, ended or not, for a page that shows its work in progress and how the
// last run ended.
export async function latestJob(database: Database, kind: string) {
  const [row] = await database
    .select()
    .from(jobs)
    .where(eq(jobs.kind, kind))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return row ?? null;
}
async function selectCandidate(database: Database, kind: string, now: Date) {
  const [candidate] = await database
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, kind),
        eq(jobs.cancelRequested, false),
        or(isNull(jobs.deadlineAt), gt(jobs.deadlineAt, now)),
        lt(jobs.attempt, jobs.maxAttempts),
        or(
          and(eq(jobs.status, 'queued'), lte(jobs.runAfter, now)),
          and(eq(jobs.status, 'running'), lte(jobs.leaseExpiresAt, now)),
        ),
      ),
    )
    .orderBy(desc(jobs.priority), jobs.createdAt)
    .limit(1);
  return candidate;
}
async function writeClaim(database: Database, candidate: Claimed, owner: string, now: Date) {
  if (candidate.status === 'running')
    await database
      .update(jobAttempts)
      .set({ status: 'abandoned', finishedAt: now, error: 'lease_expired' })
      .where(and(eq(jobAttempts.jobId, candidate.id), eq(jobAttempts.attempt, candidate.attempt)));
  const [row] = await database
    .update(jobs)
    .set({
      status: 'running',
      attempt: candidate.attempt + 1,
      leaseOwner: owner,
      leaseExpiresAt: new Date(now.getTime() + 120000),
      startedAt: now,
    })
    .where(eq(jobs.id, candidate.id))
    .returning();
  if (!row) throw new Error('Claim failed');
  await database.insert(jobAttempts).values({
    id: id(),
    jobId: row.id,
    attempt: row.attempt,
    leaseOwner: owner,
    status: 'running',
  });
  return row;
}
function fence(job: Claimed) {
  return and(
    eq(jobs.id, job.id),
    eq(jobs.attempt, job.attempt),
    eq(jobs.leaseOwner, job.leaseOwner ?? ''),
    eq(jobs.status, 'running'),
    gt(jobs.leaseExpiresAt, new Date()),
  );
}
// The heartbeat fires on a timer, outside any transaction, so it joins the write queue like every
// other writer (ADR 0029); a bare write on the pool would block the process behind a request.
export async function renew(job: Claimed) {
  const rows = await withTransaction(db(), (database) =>
    database
      .update(jobs)
      .set({ leaseExpiresAt: new Date(Date.now() + 120000) })
      .where(
        and(
          fence(job),
          eq(jobs.cancelRequested, false),
          or(isNull(jobs.deadlineAt), gt(jobs.deadlineAt, new Date())),
        ),
      )
      .returning(),
  );
  return rows.length === 1;
}
export async function publish(
  job: Claimed,
  result: z.infer<ReturnType<typeof z.json>>,
  effect: (database: Database) => Promise<void> = async () => {},
) {
  await withTransaction(db(), async (database) => {
    const rows = await database
      .update(jobs)
      .set({ status: 'succeeded', result, finishedAt: new Date(), leaseExpiresAt: null })
      .where(and(fence(job), eq(jobs.cancelRequested, false)))
      .returning();
    if (!rows.length) throw new Error('Job fence rejected');
    await effect(database);
    await database
      .update(jobAttempts)
      .set({ status: 'succeeded', finishedAt: new Date() })
      .where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attempt, job.attempt)));
  });
}
// `effect` runs in the same transaction, once, when the job has failed for good.
export async function fail(
  job: Claimed,
  error: string,
  retry = true,
  retryAfterMs?: number,
  effect: (database: Database) => Promise<void> = async () => {},
) {
  await withTransaction(db(), async (database) => {
    const [current] = await database.select().from(jobs).where(fence(job));
    if (!current) return;
    const status = current.cancelRequested
      ? 'cancelled'
      : retry && job.attempt < job.maxAttempts
        ? 'queued'
        : 'failed';
    const delay = Math.max(
      [30000, 120000, 480000][job.attempt - 1] ?? 480000,
      Number.isFinite(retryAfterMs) ? (retryAfterMs ?? 0) : 0,
    );
    const rows = await database
      .update(jobs)
      .set({
        status,
        lastError: error,
        runAfter: new Date(Date.now() + delay),
        finishedAt: status === 'queued' ? null : new Date(),
        leaseExpiresAt: null,
      })
      .where(fence(job))
      .returning();
    if (!rows.length) return;
    await database
      .update(jobAttempts)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attempt, job.attempt)));
    if (status === 'failed') await effect(database);
  });
}
export function listJobs(database: Database) {
  return database
    .select()
    .from(jobs)
    .where(gt(jobs.createdAt, new Date(Date.now() - 7 * 86400000)))
    .orderBy(desc(jobs.createdAt))
    .limit(100);
}
export async function prune(database: Database) {
  await database
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - 30 * 86400000)));
  await database
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, new Date(Date.now() - 86400000)));
  await database.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
export async function dueSchedules(database: Database) {
  return database.select().from(schedules).where(eq(schedules.enabled, true));
}
export async function markOccurrence(database: Database, scheduleId: string, occurrence: Date) {
  await database
    .update(schedules)
    .set({ lastOccurrence: occurrence, updatedAt: new Date() })
    .where(eq(schedules.id, scheduleId));
}
export async function jobsHealth() {
  return db()
    .select({
      status: jobs.status,
      count: count(),
      oldest: sql<Date | null>`min(${jobs.createdAt})`.mapWith(jobs.createdAt),
    })
    .from(jobs)
    .where(inArray(jobs.status, ['queued', 'running']))
    .groupBy(jobs.status);
}

export async function requestedCancellations(activeIds: string[]) {
  if (!activeIds.length) return [];
  return db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.id, activeIds), eq(jobs.cancelRequested, true)));
}
