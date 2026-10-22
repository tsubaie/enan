import { expect, it } from 'vitest';
import { FeedQuery, Notification, NotificationFeed, NotificationKind } from '../schema/validation';
const line = {
  id: '01a08a9f-1991-760a-b73a-568f6f866500',
  kind: 'task.assigned',
  subjectType: 'tasks',
  subjectId: '01a08a9f-1991-760a-b73a-568f6f866501',
  title: 'Review the board pack',
  href: '/tasks?id=01a08a9f-1991-760a-b73a-568f6f866501',
  actorName: 'Assigning Actor',
  createdAt: '2026-09-10T09:00:00.000Z',
  readAt: null,
};
it('NOTIF-I03 NOTIF-B04 ADMIN-B59 the kinds are the six of v1 and the five update kinds, nothing else', () => {
  expect([...NotificationKind.options].sort()).toEqual(
    [
      'task.assigned',
      'task.due_today',
      'task.overdue',
      'note.mentioned',
      'kpi.off_target',
      'job.finished',
      'update.installed',
      'update.failed',
      'update.rollback_failed',
      'update.blocked',
      'update.stalled',
    ].sort(),
  );
  expect(NotificationKind.safeParse('task.commented').success).toBe(false);
  expect(NotificationKind.safeParse('TASK.ASSIGNED').success).toBe(false);
  expect(NotificationKind.safeParse('').success).toBe(false);
});
it('NOTIF-B08 the feed query coerces and bounds its page size and refuses unknown parameters', () => {
  expect(FeedQuery.parse({ limit: '20' })).toEqual({ limit: 20 });
  expect(FeedQuery.parse({})).toEqual({});
  expect(FeedQuery.safeParse({ limit: '1' }).success).toBe(true);
  expect(FeedQuery.safeParse({ limit: '50' }).success).toBe(true);
  expect(FeedQuery.safeParse({ limit: '0' }).success).toBe(false);
  expect(FeedQuery.safeParse({ limit: '51' }).success).toBe(false);
  expect(FeedQuery.safeParse({ limit: '2.5' }).success).toBe(false);
  expect(FeedQuery.safeParse({ cursor: 'x'.repeat(64) }).success).toBe(true);
  expect(FeedQuery.safeParse({ cursor: 'x'.repeat(65) }).success).toBe(false);
  // The reader is `ctx.user`, never a parameter (NOTIF-I04): a user id in the query is refused.
  expect(FeedQuery.safeParse({ userId: line.id }).success).toBe(false);
  expect(FeedQuery.safeParse({ unknown: '1' }).success).toBe(false);
});
it('NOTIF-B06 NOTIF-B08 a feed line carries its resolved title and link, a nullable actor and read time', () => {
  expect(Notification.parse(line)).toEqual(line);
  expect(Notification.safeParse({ ...line, actorName: null }).success).toBe(true);
  expect(Notification.safeParse({ ...line, readAt: '2026-09-10T10:00:00.000Z' }).success).toBe(
    true,
  );
  // The title and link come from the owning module at read time; a line without them is not
  // drawable, so the schema refuses it rather than letting the centre render a blank row.
  const { title, ...untitled } = line;
  void title;
  expect(Notification.safeParse(untitled).success).toBe(false);
  const { href, ...unlinked } = line;
  void href;
  expect(Notification.safeParse(unlinked).success).toBe(false);
  expect(Notification.safeParse({ ...line, kind: 'task.commented' }).success).toBe(false);
  expect(Notification.safeParse({ ...line, subjectId: 'not-a-uuid' }).success).toBe(false);
  expect(
    NotificationFeed.safeParse({ data: { items: [line], unread: 1, nextCursor: null } }).success,
  ).toBe(true);
  expect(
    NotificationFeed.safeParse({
      data: { items: [], unread: 0, nextCursor: '2026-09-10T09:00:00.000Z' },
    }).success,
  ).toBe(true);
  expect(
    NotificationFeed.safeParse({ data: { items: [], unread: 1.5, nextCursor: null } }).success,
  ).toBe(false);
  expect(NotificationFeed.safeParse({ data: { items: [], unread: 0 } }).success).toBe(false);
});
