import 'server-only';
import { z } from 'zod';
import { defineHandler, authenticated } from './handler';
import { checkConnection, aiConnection } from '@/core/ai/client';
import { deleteBackup, listBackups } from '@/core/backup/dump';
import { writeAudit } from '@/core/db/audit-repo';
import { Manifest } from '@/core/backup/manifest';
import { enqueue, latestJob, listJobs } from '@/core/db/jobs-repo';
import { env } from '@/core/config/env';
import { auditEntries, cancelJob, readJob } from '@/core/db/admin-repo';
import { Job } from '@/core/jobs/types';
import { JobKind } from '@/core/jobs/registry';
import { AppError } from './errors';
const Empty = z.strictObject({});
const Connection = z.object({
  state: z.string(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export const aiStatus = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({ data: Connection }),
  handler: async () => ({ data: aiConnection() }),
});
export const aiTest = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({ data: Connection }),
  transaction: false,
  handler: async () => ({ data: await checkConnection() }),
});
export const backups = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({
    data: z.array(Manifest),
    meta: z.object({ runner: z.boolean(), job: Job.nullable() }),
  }),
  // listBackups checksums every backup file.
  transaction: false,
  // ADMIN-B46: the list carries the latest backup job and whether this server runs jobs at all, so
  // the page shows a backup still to come and never implies that one nobody will run is on its way.
  handler: async (_, ctx) => {
    const job = await latestJob(ctx.db, 'system.backup');
    return {
      data: await listBackups(),
      meta: {
        runner: env().JOBS_ENABLED,
        job: job ? Job.parse(JSON.parse(JSON.stringify(job))) : null,
      },
    };
  },
});
// ADMIN-B12: the audit entry is written first, so a folder that cannot be removed leaves no record
// of a deletion that did not happen.
export const backupDelete = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({ data: z.null() }),
  handler: async (_, ctx, params) => {
    const backupId = z.uuid().safeParse(params.id);
    if (!backupId.success) throw new AppError('not_found');
    await writeAudit(ctx.db, authenticated(ctx).user.id, 'delete', 'backup', backupId.data, {});
    if (!(await deleteBackup(backupId.data))) throw new AppError('not_found');
    return { data: null };
  },
});
export const backupCreate = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({ data: z.object({ id: z.uuid() }) }),
  status: 202,
  idempotent: true,
  enqueues: true,
  handler: async (_, ctx) => ({
    data: await enqueue(
      ctx.db,
      'system.backup',
      {},
      'system.backup:manual',
      authenticated(ctx).user.id,
    ),
  }),
});
export const jobList = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({ data: z.array(Job) }),
  handler: async (_, ctx) => ({
    data: z.array(Job).parse(JSON.parse(JSON.stringify(await listJobs(ctx.db)))),
  }),
});
export const auditList = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({
    data: z.array(
      z.object({
        id: z.uuid(),
        action: z.string(),
        entityType: z.string(),
        entityId: z.string().nullable(),
        actorName: z.string().nullable(),
        createdAt: z.string(),
        diff: z.json(),
      }),
    ),
  }),
  handler: async (_, ctx) => ({ data: JSON.parse(JSON.stringify(await auditEntries(ctx.db))) }),
});
export const jobAction = defineHandler({
  guard: 'admin',
  input: z.strictObject({ action: z.enum(['retry', 'cancel']) }),
  response: z.object({ data: z.object({ id: z.uuid() }) }),
  idempotent: true,
  enqueues: true,
  handler: async (input, ctx, params) => {
    const job = await readJob(ctx.db, z.uuid().parse(params.id));
    if (!job) throw new AppError('not_found');
    if (input.action === 'cancel') {
      await cancelJob(ctx.db, job.id);
      return { data: { id: job.id } };
    }
    if (!['failed', 'cancelled'].includes(job.status))
      throw new AppError('conflict', { reason: 'state' });
    return {
      data: await enqueue(
        ctx.db,
        JobKind.parse(job.kind),
        z.json().parse(job.payload),
        null,
        authenticated(ctx).user.id,
      ),
    };
  },
});
