import 'server-only';
import { z } from 'zod';
import type { JobHandler } from '@/core/jobs/types';
import { notifyUpdates, updatesJob } from './notifications';
export const userJobs: Record<string, JobHandler> = {
  // ADMIN-B59: scheduled every five minutes (drizzle/0008); reads the updater's files and writes
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
