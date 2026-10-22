import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { resetDatabase } from '@/core/db/reset';
import { claim, dueSchedules } from '@/core/db/jobs-repo';
import { jobs, schedules } from '@/core/db/system-schema';
import { eq } from 'drizzle-orm';
import { handlerFor } from '../registry';
import { scheduleDue } from '../scheduler';
beforeAll(() => resetDatabase());
afterAll(() => closeDatabase());
it('ADMIN-B12 NOTIF-B10 ADMIN-B59 a migrated database schedules the backup, prune, notification purge and update notifications', async () => {
  const kinds = (await dueSchedules(db())).map((row) => row.kind).sort();
  expect(kinds).toEqual([
    'system.backup',
    'system.notifications_purge',
    'system.prune',
    'tasks.reminders',
    // ADMIN-B59: update notifications, every five minutes.
    'users.updates',
  ]);
  await scheduleDue(new Date('2026-10-21T12:00:00Z'));
  // The purge publishes through the transaction it is given; a write on the pool would deadlock.
  const purge = await claim('test-owner', 'system.notifications_purge', 1, 1);
  if (!purge) throw new Error('the scheduled purge was not queued');
  await withTransaction(db(), (database) =>
    handlerFor('system.notifications_purge').publish(database, purge, null),
  );
});
it('ADMIN-B55 a schedule for a job kind this release does not know is left alone', async () => {
  // As after rolling back to a release older than the migration that added the schedule.
  await db()
    .insert(schedules)
    .values({
      id: '01a17d2c-0000-7000-8000-00000000f00d',
      kind: 'future.kind',
      cron: '* * * * *',
      timezone: 'UTC',
      payload: {},
    });
  await scheduleDue(new Date('2026-10-21T13:00:00Z'));
  expect(await db().select().from(jobs).where(eq(jobs.kind, 'future.kind'))).toEqual([]);
});
