import 'server-only';
import {
  and,
  eq,
  gt,
  lte,
  isNull,
  or,
  sql,
  desc,
  count,
  inArray,
  lt,
  ne,
  max,
  not,
} from 'drizzle-orm';
import {
  auditLog,
  jobs,
  jobAttempts,
  schedules,
  loginAttempts,
  signInCodes,
  idempotencyKeys,
} from './system-schema';
import { authSessions } from './auth-schema';
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
    await sweepQueue(database, now);
    if (!(await admits(database, kind, concurrency, globalLimit, now))) return null;
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
// When a kind last finished successfully, for a scheduled job that reports what happened since.
// `current` is the asking job: publish marks it succeeded before its effect runs, in the same
// transaction, so without excluding it every run would find itself.
export async function lastSucceeded(database: Database, kind: string, current: string) {
  const [row] = await database
    .select({ finishedAt: jobs.finishedAt })
    .from(jobs)
    .where(and(eq(jobs.kind, kind), eq(jobs.status, 'succeeded'), ne(jobs.id, current)))
    .orderBy(desc(jobs.finishedAt))
    .limit(1);
  return row?.finishedAt ?? null;
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
// ADMIN-B33: a job stopped by a shutdown is retried later whatever its kind and however many
// attempts it used: the interrupted attempt is given back and its row removed, so the next claim
// reuses its number (one row per attempt number).
function afterFailure(
  current: Claimed,
  job: Claimed,
  error: string,
  retry: boolean,
  retryAfterMs: number | undefined,
) {
  const interrupted = error === 'shutdown' && !current.cancelRequested;
  const status = current.cancelRequested
    ? 'cancelled'
    : interrupted || (retry && job.attempt < job.maxAttempts)
      ? 'queued'
      : 'failed';
  const backoff = [30000, 120000, 480000][job.attempt - 1] ?? 480000;
  const asked = Number.isFinite(retryAfterMs) ? (retryAfterMs ?? 0) : 0;
  const delay = interrupted ? 0 : Math.max(backoff, asked);
  return { interrupted, status, delay };
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
    const { interrupted, status, delay } = afterFailure(current, job, error, retry, retryAfterMs);
    const rows = await database
      .update(jobs)
      .set({
        status,
        lastError: error,
        runAfter: new Date(Date.now() + delay),
        finishedAt: status === 'queued' ? null : new Date(),
        leaseExpiresAt: null,
        ...(interrupted ? { attempt: job.attempt - 1 } : {}),
      })
      .where(fence(job))
      .returning();
    if (!rows.length) return;
    const attempt = and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attempt, job.attempt));
    if (interrupted) await database.delete(jobAttempts).where(attempt);
    else
      await database
        .update(jobAttempts)
        .set({ status: 'failed', error, finishedAt: new Date() })
        .where(attempt);
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
  const monthAgo = new Date(Date.now() - 30 * 86400000);
  await database.delete(loginAttempts).where(lt(loginAttempts.createdAt, monthAgo));
  // ADMIN-B72: sign-ins, which anyone can cause by failing one, live as long as the attempts.
  await database
    .delete(auditLog)
    .where(and(eq(auditLog.entityType, 'session'), lt(auditLog.createdAt, monthAgo)));
  await database
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, new Date(Date.now() - 86400000)));
  await database.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
  await database
    .delete(signInCodes)
    .where(lt(signInCodes.createdAt, new Date(Date.now() - 86400000)));
  // Finished jobs older than 30 days, with their attempts (cascade): they carry copies of note and
  // task text in payload and result. The newest success of each kind stays, since a job's
  // "since my last run" (lastSucceeded) reads it, and so does a job a note refinement still names:
  // that link has no delete rule, and restoring a discarded refinement reads the job's result.
  const newest = await database
    .select({ kind: jobs.kind, finishedAt: max(jobs.finishedAt) })
    .from(jobs)
    .where(eq(jobs.status, 'succeeded'))
    .groupBy(jobs.kind);
  const kept = newest.flatMap((row) =>
    row.finishedAt
      ? [
          and(
            eq(jobs.kind, row.kind),
            eq(jobs.status, 'succeeded'),
            eq(jobs.finishedAt, row.finishedAt),
          ),
        ]
      : [],
  );
  await database
    .delete(jobs)
    .where(
      and(
        inArray(jobs.status, ['succeeded', 'failed', 'cancelled']),
        lt(jobs.finishedAt, new Date(Date.now() - 30 * 86400000)),
        sql`not exists (select 1 from note_refinements r where r.job_id = ${jobs.id})`,
        ...(kept.length ? [not(or(...kept) ?? sql`false`)] : []),
      ),
    );
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
