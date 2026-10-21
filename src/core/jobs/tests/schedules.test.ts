import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { resetDatabase } from '@/core/db/reset';
import { claim, dueSchedules } from '@/core/db/jobs-repo';
import { handlerFor } from '../registry';
import { scheduleDue } from '../scheduler';
beforeAll(() => resetDatabase());
afterAll(() => closeDatabase());
it('ADMIN-B12 NOTIF-B10 a migrated database schedules the backup, prune and notification purge', async () => {
  const kinds = (await dueSchedules(db())).map((row) => row.kind).sort();
  expect(kinds).toEqual(['system.backup', 'system.notifications_purge', 'system.prune']);
  await scheduleDue(new Date('2026-10-21T12:00:00Z'));
  // The purge publishes through the transaction it is given; a write on the pool would deadlock.
  const purge = await claim('test-owner', 'system.notifications_purge', 1, 1);
  if (!purge) throw new Error('the scheduled purge was not queued');
  await withTransaction(db(), (database) =>
    handlerFor('system.notifications_purge').publish(database, purge, null),
  );
});
