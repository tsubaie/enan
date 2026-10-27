import 'server-only';
import { CronExpressionParser } from 'cron-parser';
import { db, withTransaction } from '@/core/db/client';
import { dueSchedules, markOccurrence, enqueue } from '@/core/db/jobs-repo';
import { z } from 'zod';
import { logger } from '@/core/config/logger';
import { isRestoring } from '@/core/backup/maintenance';
import { jobKinds } from './registry';
export async function scheduleDue(now = new Date()) {
  // ADMIN-B13: nothing is queued during a restore; the write would hit the database being replaced.
  if (await isRestoring()) return;
  await withTransaction(db(), async (database) => {
    for (const schedule of await dueSchedules(database)) {
      // ADR 0050: after a rollback the database can hold a schedule a newer release added, for a
      // kind this build cannot run. Queueing it would leave a job no worker ever claims.
      if (!jobKinds.includes(schedule.kind)) continue;
      // Each schedule in its own savepoint: a bad cron or time zone, or a full queue for one kind,
      // skips that schedule only and must never stop the backup or the others from being queued.
      try {
        await withTransaction(database, async (savepoint) => {
          const occurrence = CronExpressionParser.parse(schedule.cron, {
            currentDate: now,
            tz: schedule.timezone,
          })
            .prev()
            .toDate();
          if (schedule.lastOccurrence && occurrence <= schedule.lastOccurrence) return;
          await enqueue(
            savepoint,
            schedule.kind,
            z.json().parse(schedule.payload),
            `${schedule.kind}:${occurrence.toISOString()}`,
          );
          await markOccurrence(savepoint, schedule.id, occurrence);
        });
      } catch (error) {
        logger.error(
          { err: error, scheduleId: schedule.id, kind: schedule.kind },
          'Schedule skipped',
        );
      }
    }
  });
}
