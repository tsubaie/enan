import 'server-only';
import { z } from 'zod';
import { createBackup, pruneBackups } from '@/core/backup/dump';
import { prune } from '@/core/db/jobs-repo';
import { purgeExpired } from '@/core/notifications/retention';
import { purgeTrash } from '@/core/db/trash-repo';
import { logger } from '@/core/config/logger';
import { db } from '@/core/db/client';
import { getSetting } from '@/core/db/settings-repo';
import { mergeJobs } from '@/core/modules/registry';
import type { JobHandler } from './types';
const system: Record<string, JobHandler> = {
  'system.noop': {
    concurrency: 4,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    publish: async () => {},
  },
  'system.prune': {
    concurrency: 1,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    publish: prune,
  },
  // ADMIN-B48 TASKS-B11: the trash older than `retention.trash_days` goes for good; 0 keeps it.
  'system.trash_purge': {
    concurrency: 1,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    // The publish transaction's handle: a write on the pool here would wait on this very lock.
    publish: async (database) => {
      const days = await getSetting(database, 'retention.trash_days');
      if (days <= 0) return;
      const removed = await purgeTrash(database, new Date(Date.now() - days * 86400000));
      if (Object.keys(removed).length) logger.info({ removed }, 'Trash purged');
    },
  },
  // NOTIF-B10: retention. A system kind rather than a module's, because the notifications module
  // is the consumer of the contributions and core owns the rows (ADR 0022).
  'system.notifications_purge': {
    concurrency: 1,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    // The publish transaction's handle: a write on the pool here would wait on this very lock.
    publish: async (database) => {
      await purgeExpired(database);
    },
  },
  'system.backup': {
    concurrency: 1,
    schema: z.strictObject({}),
    // ADMIN-B12 ADMIN-B48: once the new backup is written, older ones beyond
    // `retention.backup_count` are deleted; 0 keeps them all.
    run: async (job, signal) => {
      const manifest = await createBackup(job.id, signal);
      await pruneBackups(await getSetting(db(), 'retention.backup_count'));
      return z.json().parse(manifest);
    },
    publish: async () => {},
  },
};
// System kinds plus every kind a module declares in its server manifest.
export const registry: Record<string, JobHandler> = mergeJobs(system);
export const jobKinds = Object.keys(registry);
export const JobKind = z.string().refine((kind) => kind in registry, 'unknown job kind');
export function handlerFor(kind: string) {
  const handler = registry[kind];
  if (!handler) throw new Error(`Unknown job kind ${kind}`);
  return handler;
}
