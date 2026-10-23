import 'server-only';
import { z } from 'zod';
import type { JobHandler } from '@/core/jobs/types';
import { db, withTransaction } from '@/core/db/client';
import { enqueue } from '@/core/db/jobs-repo';
import { logger } from '@/core/config/logger';
import { watchStatus } from '@/core/updates/updater';
import { notifyUpdates, updatesJob } from './notifications';
export const userJobs: Record<string, JobHandler> = {
  // ADMIN-B59: queued when the updater writes its status (watchUpdates) and daily (drizzle/0015)
  // as a safety net that also notices a stopped updater; reads the updater's files and writes
  // notifications in the publish transaction.
  [updatesJob]: {
    concurrency: 1,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    publish: async (database, job) => {
      await notifyUpdates(database, job.id);
    },
  },
};

// ADMIN-B59, ADR 0059: one queued run per change of the updater's status; a run already waiting
// covers the next change too. Returns the function that stops watching.
export function watchUpdates() {
  return watchStatus(
    () =>
      void withTransaction(db(), (database) => enqueue(database, updatesJob, {}, updatesJob)).catch(
        (error) => logger.error({ err: error }, 'Update notifications not queued'),
      ),
  );
}
