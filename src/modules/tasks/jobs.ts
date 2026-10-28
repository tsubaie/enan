import 'server-only';
import { z } from 'zod';
import { type JobHandler } from '@/core/jobs/types';
import { executeAi } from '@/core/ai/execute';
import { AiPayload } from '@/core/ai/job-schema';
import { BreakdownOutput } from './schema/validation';
import { BREAKDOWN_PROMPT } from './ai/prompts/breakdown.v1';
import { retention } from '@/core/config/notifications';
import { getSetting } from '@/core/db/settings-repo';
import { selectNotifiedSince } from '@/core/db/notifications-repo';
import { emitUnattended } from '@/core/notifications/emit';
import { dayValue } from '@/core/time/days';
import { addDays, dayAt } from '@/core/time/tasks';
import { selectOwnedDueBetween, type OwnedDue } from './repo';
const notice = (kind: string, task: OwnedDue) => ({
  kind,
  subjectType: 'tasks',
  subjectId: task.id,
  to: [task.userId],
});
export const taskJobs: Record<string, JobHandler> = {
  // NOTIF-B04/B05: once a day, the owner hears of a task due today and, once it is past its date,
  // that it is overdue: once, not again every morning it stays late. The scheduler's per-occurrence
  // key runs it once a day, and the upsert keeps a re-run from adding rows. The overdue pass looks
  // back over every late task, not only yesterday's, so a run the box missed is caught up by the
  // next; it stops at the read-notification retention (NOTIF-B10), inside which a task already
  // told still has its line, so none is told twice and a purged line never comes back as news.
  'tasks.reminders': {
    concurrency: 1,
    schema: z.strictObject({}),
    run: async () => ({ completed: true }),
    publish: async (database) => {
      const today = dayAt(await getSetting(database, 'workspace.timezone'));
      const from = addDays(today, -retention.readDays);
      const dueToday = await selectOwnedDueBetween(database, today, today);
      const late = await selectOwnedDueBetween(database, from, addDays(today, -1));
      const told = await selectNotifiedSince(
        database,
        'task.overdue',
        late.map((task) => task.id),
        new Date(dayValue(from)),
      );
      await emitUnattended(database, [
        ...dueToday.map((task) => notice('task.due_today', task)),
        ...late.filter((task) => !told.has(task.id)).map((task) => notice('task.overdue', task)),
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
