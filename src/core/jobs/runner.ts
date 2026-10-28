import 'server-only';
import { AppError } from '@/core/http/errors';
import { z } from 'zod';
import { env } from '@/core/config/env';
import { logger } from '@/core/config/logger';
import { id } from '@/core/db/ids';
import { DatabaseBusyError } from '@/core/db/client';
import { activeKinds } from '@/core/db/jobs-queue-repo';
import {
  claim,
  renew,
  publish,
  fail,
  requestedCancellations,
  type Claimed,
} from '@/core/db/jobs-repo';
import { handlerFor, jobKinds } from './registry';
import { scheduleDue } from './scheduler';
import { AiPayload } from '@/core/ai/job-schema';
import { emitUnattended } from '@/core/notifications/emit';
import type { Database } from '@/core/db/client';
import { isRestoring } from '@/core/backup/maintenance';
function startHeartbeat(job: Claimed, controller: AbortController) {
  return setInterval(() => {
    void renew(job).then(
      (ok) => {
        if (!ok) controller.abort();
      },
      (error) => {
        // A renewal that waited out the write lock is contention: the lease outlasts several
        // heartbeats, so the next one renews it.
        if (error instanceof DatabaseBusyError)
          return logger.warn({ err: error, jobId: job.id }, 'Lease renewal waited out the lock');
        controller.abort();
        logger.error({ err: error, jobId: job.id }, 'Lease renewal failed');
      },
    );
  }, 30000);
}
// The abort reason the drain uses. A handler stopped with it was interrupted, not broken, so its
// attempt is retried whatever the job kind (ADMIN-B33); cancellations and lost leases abort
// without it and keep their own outcome.
const shutdown = new Error('shutdown');
// How a failed attempt is recorded: the error kept on the job, whether it retries, and any delay
// the provider asked for. AI jobs retry only on transient reasons; other jobs always retry.
function failure(
  job: Claimed,
  error: unknown,
  signal: AbortSignal,
): [string, boolean, number | undefined] {
  if (signal.reason === shutdown) return ['shutdown', true, undefined];
  const detail =
    error instanceof AppError
      ? z
          .object({ reason: z.string().optional(), retryAfterMs: z.number().optional() })
          .safeParse(error.details)
      : null;
  const reason = detail?.success ? detail.data.reason : undefined;
  const retryAfterMs = detail?.success ? detail.data.retryAfterMs : undefined;
  if (job.kind.startsWith('ai.'))
    return [
      reason ?? 'provider',
      ['network', 'rate_limit', 'invalid_output'].includes(reason ?? ''),
      retryAfterMs,
    ];
  return [error instanceof Error ? error.message : String(error), true, retryAfterMs];
}
// NOTIF-B04 `job.finished`: whoever asked for an AI result hears that it is ready, or that it failed,
// about the note or task it ran on. System and scheduled jobs have nobody waiting on them.
function finished(job: Claimed) {
  const payload = AiPayload.safeParse(job.payload);
  return async (database: Database) => {
    if (!job.createdBy || !payload.success) return;
    const [subjectType = ''] = payload.data.capability.split('.');
    await emitUnattended(database, [
      { kind: 'job.finished', subjectType, subjectId: payload.data.entityId, to: [job.createdBy] },
    ]);
  };
}
async function runJob(job: Claimed, active: Map<string, AbortController>) {
  const controller = new AbortController();
  active.set(job.id, controller);
  const handler = handlerFor(job.kind);
  const heartbeat = startHeartbeat(job, controller);
  try {
    handler.schema.parse(job.payload);
    const result = await handler.run(job, controller.signal);
    controller.signal.throwIfAborted();
    await publish(job, result, async (database) => {
      await handler.publish(database, job, result);
      await finished(job)(database);
    });
  } catch (error) {
    await fail(job, ...failure(job, error, controller.signal), finished(job));
  } finally {
    clearInterval(heartbeat);
    active.delete(job.id);
  }
}
// Resolves true when every promise settled within the window, false when the window ran out.
async function settledWithin(pending: Set<Promise<void>>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const done = Promise.allSettled([...pending]).then((): true => true);
  const result = await Promise.race([done, expired]);
  clearTimeout(timer);
  return result;
}
// Grace given to handlers after the forced abort, so each can record its failed attempt.
const abortGraceMs = 5000;
// ADR 0067: one read outside the lock says which kinds have work; an idle tick claims nothing.
async function claimable() {
  const pending = await activeKinds();
  return jobKinds.filter((kind) => pending.includes(kind));
}
/**
 * ADMIN-B33 stopping the runner stops claiming, lets running handlers finish for up to
 * JOBS_DRAIN_SECONDS, then aborts the rest through their signals and waits for them to record
 * the attempt; the returned promise settles when that is done.
 */
export function startRunner() {
  const owner = id();
  const active = new Map<string, AbortController>();
  const running = new Set<Promise<void>>();
  let stopped = false;
  let round: Promise<void> | undefined;
  function launch(job: Claimed) {
    const execution = runJob(job, active).catch((error) =>
      logger.error({ err: error, jobId: job.id }, 'Job failed'),
    );
    running.add(execution);
    void execution.finally(() => running.delete(execution));
  }
  async function claimRound() {
    try {
      // ADMIN-B13: nothing starts during a restore; its writes would hit the database being replaced.
      if (await isRestoring()) return;
      for (const cancelled of await requestedCancellations([...active.keys()]))
        active.get(cancelled.id)?.abort();
      for (const kind of await claimable()) {
        if (stopped) return;
        const job = await claim(owner, kind, handlerFor(kind).concurrency, env().JOBS_CONCURRENCY);
        if (job) launch(job);
      }
    } catch (error) {
      // ADMIN-B38: a claim that waited out the write lock is contention, logged as a warning; the
      // next tick claims again.
      if (error instanceof DatabaseBusyError)
        logger.warn({ err: error }, 'Runner tick waited out the database write lock');
      else logger.error({ err: error }, 'Runner tick failed');
    }
  }
  function tick() {
    if (stopped || round) return;
    round = claimRound().finally(() => {
      round = undefined;
    });
  }
  const interval = setInterval(tick, 1000);
  const scheduler = setInterval(
    () => void scheduleDue().catch((error) => logger.error({ err: error }, 'Scheduler failed')),
    60000,
  );
  void scheduleDue().catch((error) => logger.error({ err: error }, 'Scheduler startup failed'));
  let stopping: Promise<void> | undefined;
  async function drain() {
    stopped = true;
    clearInterval(interval);
    clearInterval(scheduler);
    await round;
    if (await settledWithin(running, env().JOBS_DRAIN_SECONDS * 1000)) return;
    logger.warn({ jobs: [...active.keys()] }, 'Drain window elapsed; aborting running jobs');
    for (const controller of active.values()) controller.abort(shutdown);
    await settledWithin(running, abortGraceMs);
  }
  return () => {
    stopping ??= drain();
    return stopping;
  };
}
