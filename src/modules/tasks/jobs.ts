import 'server-only';
import { z } from 'zod';
import { type JobHandler } from '@/core/jobs/types';
import { executeAi } from '@/core/ai/execute';
import { AiPayload } from '@/core/ai/job-schema';
import { BreakdownOutput } from './schema/validation';
import { BREAKDOWN_PROMPT } from './ai/prompts/breakdown.v1';
import { getSetting } from '@/core/db/settings-repo';
import { emitUnattended } from '@/core/notifications/emit';
import { addDays, dayAt } from '@/core/time/tasks';
import { selectOwnedDueOn } from './repo';
export const taskJobs: Record<string, JobHandler> = {
  // NOTIF-B04/B05: once a day, the owner hears of a task due today and, the day after its date, that
  // it is overdue: once, not again every morning it stays late. The scheduler's per-occurrence key
  // runs it once a day, and the upsert keeps a re-run from adding rows.
  'tasks.reminders': {
    concurrency: 1,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    publish: async (database) => {
      const today = dayAt(await getSetting(database, 'workspace.timezone'));
      const remind = async (kind: string, day: string) =>
        (await selectOwnedDueOn(database, day)).map((task) => ({
          kind,
          subjectType: 'tasks',
          subjectId: task.id,
          to: [task.userId],
        }));
      await emitUnattended(database, [
        ...(await remind('task.due_today', today)),
        ...(await remind('task.overdue', addDays(today, -1))),
      ]);
    },
  },
  'ai.tasks.breakdown': {
    concurrency: 2,
    schema: AiPayload,
    run: async (job, signal) => {
      const output = await executeAi(job, BREAKDOWN_PROMPT, BreakdownOutput, signal);
      const source = z
        .object({ dueDate: z.string().nullable() })
        .parse(AiPayload.parse(job.payload).input);
      const warnings: string[] = [];
      const subtasks = output.subtasks
        .filter(
          (task, index, all) => all.findIndex((other) => other.title === task.title) === index,
        )
        .map((task) => {
          if (
            task.dueDate &&
            (!z.iso.date().safeParse(task.dueDate).success ||
              (source.dueDate && task.dueDate > source.dueDate))
          ) {
            warnings.push('invalid_due_date');
            return { ...task, dueDate: null };
          }
          return task;
        });
      return { output: { subtasks }, warnings };
    },
    publish: async () => {},
  },
};
