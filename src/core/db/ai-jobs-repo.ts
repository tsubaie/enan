import 'server-only';
import { and, desc, eq, gte, inArray, notExists, or, gt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { jobs, aiInvocations } from './system-schema';
import { type Database } from './client';
// Token sums over integer columns come back as integers (or null when there are no rows); the
// JSON reservation lives in the job payload, read with json_extract (ADR 0029).
const spentTokens =
  sql<number>`coalesce(sum(${aiInvocations.inputTokens} + ${aiInvocations.outputTokens} + ${aiInvocations.cacheReadTokens} + ${aiInvocations.cacheWriteTokens}), 0)`.mapWith(
    Number,
  );
const reservedTokens =
  sql<number>`coalesce(sum(json_extract(${jobs.payload}, '$.reservedTokens')), 0)`.mapWith(Number);
// ADR 0033: the dollar limit reads the same two sides in micro-dollars. A call whose cost is
// unknown (null) adds nothing; a job snapshotted without a cost reservation reserves nothing.
const spentCost =
  sql<number>`coalesce(sum(${aiInvocations.estimatedCostMicros}), 0)`.mapWith(Number);
const reservedCost =
  sql<number>`coalesce(sum(json_extract(${jobs.payload}, '$.reservedCostMicros')), 0)`.mapWith(
    Number,
  );
const activeAiJobs = and(
  sql`${jobs.kind} like 'ai.%'`,
  inArray(jobs.status, ['queued', 'running']),
);
type Totals = { tokens: number; costMicros: number } | undefined;
// Spent this month plus reserved by active jobs; an aggregate with no rows reads as zero.
function monthTotals(spent: Totals, reserved: Totals) {
  return {
    tokens: (spent?.tokens ?? 0) + (reserved?.tokens ?? 0),
    costMicros: (spent?.costMicros ?? 0) + (reserved?.costMicros ?? 0),
  };
}
export async function aiAdmissionUsage(
  database: Database,
  actor: string,
  kind: string,
  month: Date,
) {
  const [usage] = await database
    .select({ tokens: spentTokens, costMicros: spentCost })
    .from(aiInvocations)
    .where(gte(aiInvocations.createdAt, month));
  const [pending] = await database
    .select({ tokens: reservedTokens, costMicros: reservedCost })
    .from(jobs)
    .where(activeAiJobs);
  const [recent] = await database
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      oldest: sql<Date | null>`min(${jobs.createdAt})`.mapWith(jobs.createdAt),
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.createdBy, actor),
        eq(jobs.kind, kind),
        gte(jobs.createdAt, new Date(Date.now() - 3600000)),
      ),
    );
  return {
    ...monthTotals(usage, pending),
    count: recent?.count ?? 0,
    retryAfterMs: recent?.oldest
      ? Math.max(1000, recent.oldest.getTime() + 3600000 - Date.now())
      : 0,
  };
}
export async function prepareAiJob(database: Database, jobId: string, entityId: string) {
  await database
    .update(jobs)
    .set({ entityId, maxAttempts: 2, deadlineAt: new Date(Date.now() + 15 * 60000) })
    .where(eq(jobs.id, jobId));
}
export async function latestAiJob(
  database: Database,
  actor: string,
  entityId: string,
  kind: string,
) {
  const [row] = await database
    .select()
    .from(jobs)
    .where(and(eq(jobs.entityId, entityId), eq(jobs.kind, kind), eq(jobs.createdBy, actor)))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(1);
  return row;
}
// The job as the caller's transaction sees it. The name is historical: it was a `FOR UPDATE` read
// under PostgreSQL; the immediate transaction the service runs in is now the lock (ADR 0029).
export async function lockedAiJob(database: Database, jobId: string) {
  const [row] = await database.select().from(jobs).where(eq(jobs.id, jobId));
  return row;
}
export async function updateAiResult(
  database: Database,
  jobId: string,
  result: typeof jobs.$inferInsert.result,
) {
  await database.update(jobs).set({ result }).where(eq(jobs.id, jobId));
}
export async function recordInvocation(
  database: Database,
  input: typeof aiInvocations.$inferInsert,
) {
  await database.insert(aiInvocations).values(input);
}

export async function aiUsage(database: Database, month: Date) {
  const [monthly] = await database
    .select({ tokens: spentTokens, costMicros: spentCost })
    .from(aiInvocations)
    .where(gte(aiInvocations.createdAt, month));
  const [reserved] = await database
    .select({ tokens: reservedTokens, costMicros: reservedCost })
    .from(jobs)
    .where(activeAiJobs);
  const usage = await database
    .select({
      capability: aiInvocations.capability,
      calls: sql<number>`count(*)`.mapWith(Number),
      inputTokens: sql<number>`coalesce(sum(${aiInvocations.inputTokens}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${aiInvocations.outputTokens}), 0)`.mapWith(Number),
      cacheTokens:
        sql<number>`coalesce(sum(${aiInvocations.cacheReadTokens} + ${aiInvocations.cacheWriteTokens}), 0)`.mapWith(
          Number,
        ),
      estimatedCostMicros: spentCost,
    })
    .from(aiInvocations)
    .where(gte(aiInvocations.createdAt, new Date(Date.now() - 30 * 86400000)))
    .groupBy(aiInvocations.capability);
  return {
    usedTokens: monthly?.tokens ?? 0,
    reservedTokens: reserved?.tokens ?? 0,
    usedCostMicros: monthly?.costMicros ?? 0,
    reservedCostMicros: reserved?.costMicros ?? 0,
    usage,
  };
}

export async function lastInvocationError(database: Database, jobId: string) {
  const [row] = await database
    .select({ error: aiInvocations.error })
    .from(aiInvocations)
    .where(eq(aiInvocations.jobId, jobId))
    .orderBy(desc(aiInvocations.createdAt))
    .limit(1);
  return row?.error ?? null;
}

// The latest invocation per requested model since `since` (PostgreSQL's DISTINCT ON): a row is
// kept when no newer invocation of the same model exists, newest by time then id (ids are v7).
export async function recentModelOutcomes(database: Database, since: Date) {
  const newer = alias(aiInvocations, 'newer');
  return database
    .select({
      model: aiInvocations.requestedModel,
      status: aiInvocations.status,
      error: aiInvocations.error,
    })
    .from(aiInvocations)
    .where(
      and(
        gte(aiInvocations.createdAt, since),
        notExists(
          database
            .select({ one: sql`1` })
            .from(newer)
            .where(
              and(
                eq(newer.requestedModel, aiInvocations.requestedModel),
                gte(newer.createdAt, since),
                or(
                  gt(newer.createdAt, aiInvocations.createdAt),
                  and(eq(newer.createdAt, aiInvocations.createdAt), gt(newer.id, aiInvocations.id)),
                ),
              ),
            ),
        ),
      ),
    )
    .orderBy(aiInvocations.requestedModel);
}

export async function requestAiCancellation(database: Database, job: typeof jobs.$inferSelect) {
  await database
    .update(jobs)
    .set({
      cancelRequested: true,
      ...(job.status === 'queued' ? { status: 'cancelled', finishedAt: new Date() } : {}),
    })
    .where(eq(jobs.id, job.id));
}
