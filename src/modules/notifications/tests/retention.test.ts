import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { notifications } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { insertNotifications } from '@/core/db/notifications-repo';
import { purgeExpired } from '@/core/notifications/retention';
import { retention } from '@/core/config/notifications';
import { harness } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
const day = 86_400_000;
// A fixed clock: the windows are measured from the moment the purge runs, not from wall time.
const now = new Date('2026-09-10T09:00:00.000Z');
async function row(fields: { createdDaysAgo?: number; readDaysAgo?: number }) {
  const member = harness.member;
  if (!member) throw new Error('harness');
  const before = new Set(await remaining());
  await insertNotifications(db(), [
    {
      userId: member.id,
      kind: 'task.assigned',
      subjectType: 'tasks',
      subjectId: id(),
      payload: {},
      actorId: null,
    },
  ]);
  const fresh = (await remaining()).find((candidate) => !before.has(candidate));
  if (!fresh) throw new Error('no row');
  await db()
    .update(notifications)
    .set({
      createdAt: new Date(now.getTime() - (fields.createdDaysAgo ?? 0) * day),
      readAt:
        fields.readDaysAgo === undefined
          ? null
          : new Date(now.getTime() - fields.readDaysAgo * day),
    })
    .where(eq(notifications.id, fresh));
  return fresh;
}
const remaining = async () =>
  (await db().select({ id: notifications.id }).from(notifications)).map((r) => r.id).sort();
it('NOTIF-B10 the two windows are thirty days for read rows and one hundred and eighty for unread', () => {
  expect(retention).toEqual({ readDays: 30, unreadDays: 180 });
});
it('NOTIF-B10 the purge deletes read rows older than the read window and keeps the rest', async () => {
  const expired = await row({ createdDaysAgo: 60, readDaysAgo: retention.readDays + 1 });
  const kept = await row({ createdDaysAgo: 60, readDaysAgo: retention.readDays - 1 });
  // An unread row of the same age is measured against the longer window and stays.
  const unread = await row({ createdDaysAgo: 60 });
  expect(await purgeExpired(db(), now)).toBe(1);
  expect(await remaining()).toEqual([kept, unread].sort());
  expect((await remaining()).includes(expired)).toBe(false);
});
it('NOTIF-B10 the purge deletes unread rows older than the unread window and keeps the rest', async () => {
  const expired = await row({ createdDaysAgo: retention.unreadDays + 1 });
  const kept = await row({ createdDaysAgo: retention.unreadDays - 1 });
  // A row that old but read recently is governed by its read time, not its arrival.
  const readLately = await row({ createdDaysAgo: retention.unreadDays + 1, readDaysAgo: 1 });
  expect(await purgeExpired(db(), now)).toBe(1);
  expect(await remaining()).toEqual([kept, readLately].sort());
  expect((await remaining()).includes(expired)).toBe(false);
});
