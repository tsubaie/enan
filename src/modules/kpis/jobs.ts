import 'server-only';
import { z } from 'zod';
import { type JobHandler } from '@/core/jobs/types';
import { getSetting } from '@/core/db/settings-repo';
import { dayAt } from '@/core/time/tasks';
import { remindReadingsDue } from './reminders/service';
import { narrativeJob } from './ai/job';
export const kpiJobs: Record<string, JobHandler> = {
  // KPIS-B30, NOTIF-B05: once a day, the owner of a measure with no reading for the period it is in
  // hears of it, once per period. The scheduler's per-occurrence key runs it once a day.
  'kpis.reminders': {
    concurrency: 1,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    publish: async (database) => {
      await remindReadingsDue(database, dayAt(await getSetting(database, 'workspace.timezone')));
    },
  },
  'ai.kpis.narrative': narrativeJob,
};
