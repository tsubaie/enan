import 'server-only';
import { CronExpressionParser } from 'cron-parser';
import { db, withTransaction } from '@/core/db/client';
import { dueSchedules, markOccurrence, enqueue } from '@/core/db/jobs-repo';
import { z } from 'zod';
import { jobKinds } from './registry';
export async function scheduleDue(now = new Date()) {
  await withTransaction(db(), async (database) => {
    for (const schedule of await dueSchedules(database)) {
      // ADR 0050: after a rollback the database can hold a schedule a newer release added, for a
      // kind this build cannot run. Queueing it would leave a job no worker ever claims.
      if (!jobKinds.includes(schedule.kind)) continue;
      const occurrence = CronExpressionParser.parse(schedule.cron, {
        currentDate: now,
        tz: schedule.timezone,
      })
        .prev()
        .toDate();
      if (schedule.lastOccurrence && occurrence <= schedule.lastOccurrence) continue;
      await enqueue(
        database,
        schedule.kind,
        z.json().parse(schedule.payload),
        `${schedule.kind}:${occurrence.toISOString()}`,
      );
      await markOccurrence(database, schedule.id, occurrence);
    }
  });
}
