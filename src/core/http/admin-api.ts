import 'server-only';
import { z } from 'zod';
import { AuditChange, AuditType, auditTypeEntities } from '@/core/config/audit-schema';
import { dayStart } from '@/core/time/ai';
import { getSetting } from '@/core/db/settings-repo';
import { addDays } from '@/core/time/days';
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
import {
  queueCommand,
  readUpdates,
  UpdaterCommand,
  UpdaterHealth,
  UpdaterStatus,
  selfUpdateProtocol,
} from '@/core/updates/updater';
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
  // ADMIN-B72: `type` narrows the log to one kind of entry; ADMIN-B73: `change` to what was done,
  // and `from` and `to` (days, both included) to a span of time in the workspace's time zone.
  input: z.strictObject({
    type: AuditType.optional(),
    change: AuditChange.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  }),
  source: 'query',
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
  handler: async (input, ctx) => {
    const zone = await getSetting(ctx.db, 'workspace.timezone');
    const entries = await auditEntries(ctx.db, {
      ...(input.type ? { entityTypes: auditTypeEntities[input.type] } : {}),
      ...(input.change ? { change: input.change } : {}),
      ...(input.from ? { from: dayStart(zone, input.from) } : {}),
      ...(input.to ? { to: dayStart(zone, addDays(input.to, 1)) } : {}),
    });
    return { data: JSON.parse(JSON.stringify(entries)) };
  },
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
    // ADMIN-B15: an AI job is asked for again from its record, where admission checks the budget,
    // the rate limit and the reader's own access; a re-enqueue here would skip all three.
    if (job.kind.startsWith('ai.')) throw new AppError('rule_violation', { rule: 'ADMIN-B15' });
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
// ADMIN-B57: the updater's status and history as it wrote them, and whether this app can leave it
// commands. Files, not the database, so no transaction.
export const updates = defineHandler({
  guard: 'admin',
  input: Empty,
  response: z.object({
    data: z.object({
      health: UpdaterHealth,
      status: UpdaterStatus.nullable(),
      history: z.array(UpdaterStatus),
      commands: z.boolean(),
      // ADMIN-B69: the updater is older than this release of Enan needs.
      outdated: z.boolean(),
    }),
  }),
  transaction: false,
  handler: async () => ({ data: await readUpdates() }),
});
// What the updater's status rules out for a request: a paused updater installs nothing, a release
// that needs confirming is not installed without it (ADMIN-B67), and only an updater that can
// replace itself is asked to, for a newer image it knows of (ADMIN-B74). The updater refuses them too.
function refuseUnfit(input: UpdaterCommand, status: UpdaterStatus | null) {
  if (input.command === 'install') refuseInstall(input, status);
  if (
    input.command === 'update_updater' &&
    (!status?.updaterUpdate || status.protocol < selfUpdateProtocol)
  )
    throw new AppError('conflict', { reason: 'no_updater_update' });
}
function refuseInstall(
  input: Extract<UpdaterCommand, { command: 'install' }>,
  status: UpdaterStatus | null,
) {
  if (status?.paused) throw new AppError('conflict', { reason: 'updater_paused' });
  if (status?.confirm && status.candidate?.digest === input.digest && !input.confirm)
    throw new AppError('rule_violation', { reason: 'confirmation_required' });
}
// ADMIN-B58, ADMIN-B67, ADMIN-B68: Check now, Pause, Resume, Retry, Install now and the automatic
// setting are left for the updater, which acts on them as they arrive. Refused while there is no updater
// to read them, and written to the audit log.
export const updateCommand = defineHandler({
  guard: 'admin',
  input: UpdaterCommand,
  response: z.object({ data: z.object({ command: z.string() }) }),
  status: 202,
  handler: async (input, ctx) => {
    const { health, status, commands } = await readUpdates();
    if (health === 'not_running' || !commands)
      throw new AppError('conflict', { reason: 'updater_not_running' });
    refuseUnfit(input, status);
    await writeAudit(
      ctx.db,
      authenticated(ctx).user.id,
      `update_${input.command}`,
      'updater',
      null,
      input,
    );
    await queueCommand(input);
    return { data: { command: input.command } };
  },
});
