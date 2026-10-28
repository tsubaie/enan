import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { notifications } from '@/core/db/system-schema';
import { claim, enqueue, publish } from '@/core/db/jobs-repo';
import { getSetting } from '@/core/db/settings-repo';
import { handlerFor } from '@/core/jobs/registry';
import { addDays, dayAt } from '@/core/time/tasks';
import { completeTask } from '../service';
import { harness } from '@/modules/notifications/tests/fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
// One scheduled run, the way the runner publishes it.
async function remind() {
  await withTransaction(db(), (database) => enqueue(database, 'tasks.reminders', {}, null));
  const job = await claim('test-runner', 'tasks.reminders', 1, 1);
  if (!job) throw new Error('the reminder run was not queued');
  await publish(job, null, (database) =>
    handlerFor('tasks.reminders').publish(database, job, null),
  );
}
const reminders = async () =>
  (await db().select().from(notifications))
    .filter((row) => row.kind !== 'task.assigned')
    .map((row) => [row.kind, row.subjectId, row.userId, row.actorId]);
it('NOTIF-B04 NOTIF-B05 the owner hears a task is due today, and once that it went overdue, even days late or after the line was read; a re-run adds nothing', async () => {
  const member = harness.member;
  if (!member) throw new Error('harness');
  const owner = await harness.personFor(member, 'Receiving Member');
  const today = dayAt(await getSetting(db(), 'workspace.timezone'));
  const owned = (title: string, dueDate: string) =>
    harness.task(title, { ownerId: owner.id, dueDate });
  const dueToday = await owned('Sign the letter', today);
  const lateSinceYesterday = await owned('Send the minutes', addDays(today, -1));
  // A run the box missed: late for three days and never told. Past the read-notification
  // retention a late task is left alone, so a purged line never comes back.
  const missed = await owned('Long overdue', addDays(today, -3));
  await owned('Forgotten', addDays(today, -31));
  const done = await owned('Already done', today);
  await harness.run((ctx) => completeTask(ctx, done.id, done.revision));
  await harness.task('Nobody holds this', { dueDate: today });
  await remind();
  const sent = await reminders();
  expect(sent).toEqual(
    expect.arrayContaining([
      ['task.due_today', dueToday.id, member.id, null],
      ['task.overdue', lateSinceYesterday.id, member.id, null],
      ['task.overdue', missed.id, member.id, null],
    ]),
  );
  expect(sent).toHaveLength(3);
  await remind();
  expect(await reminders()).toHaveLength(3);
  // Read lines no longer block the upsert; the job itself must remember who was told.
  await db().update(notifications).set({ readAt: new Date() });
  await remind();
  expect((await reminders()).filter(([kind]) => kind === 'task.overdue')).toHaveLength(2);
});
