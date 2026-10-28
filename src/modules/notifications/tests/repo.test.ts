import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { notifications } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import {
  deleteExpired,
  insertNotifications,
  markManyRead,
  markRead,
  selectFeed,
  selectUnread,
  countRead,
  type Emission,
} from '@/core/db/notifications-repo';
import { harness } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
const hour = 3_600_000;
const users = () => {
  const { actor, member } = harness;
  if (!actor || !member) throw new Error('harness');
  return { actor, member };
};
const emission = (userId: string, fields: Partial<Emission> = {}): Emission => ({
  userId,
  kind: 'task.assigned',
  subjectType: 'tasks',
  subjectId: id(),
  payload: { actorName: 'Assigning Actor' },
  actorId: null,
  ...fields,
});
const unreadOf = async (userId: string) => (await selectUnread(db(), userId)).length;
const rows = (userId: string) =>
  db().select().from(notifications).where(eq(notifications.userId, userId));
// Moves a row back in time, so ordering and the upsert's refresh can be observed rather than
// inferred from two writes that landed in the same millisecond.
const age = (notificationId: string, hoursAgo: number) =>
  db()
    .update(notifications)
    .set({ createdAt: new Date(Date.now() - hoursAgo * hour) })
    .where(eq(notifications.id, notificationId));
it('NOTIF-I01 fan-out writes one row per recipient and reports how many it wrote', async () => {
  const { actor, member } = users();
  const subjectId = id();
  const written = await insertNotifications(db(), [
    emission(member.id, { subjectId }),
    emission(actor.id, { subjectId }),
  ]);
  expect(written).toBe(2);
  expect(await rows(member.id)).toHaveLength(1);
  expect(await rows(actor.id)).toHaveLength(1);
  expect(await insertNotifications(db(), [])).toBe(0);
});
it('NOTIF-I02 NOTIF-B03 re-emitting an unread subject refreshes the one row and inserts again once it is read', async () => {
  const { member } = users();
  const subjectId = id();
  await insertNotifications(db(), [emission(member.id, { subjectId })]);
  const [first] = await rows(member.id);
  if (!first) throw new Error('no row');
  await age(first.id, 2);
  const aged = (await rows(member.id))[0]?.createdAt.getTime() ?? 0;
  await insertNotifications(db(), [
    emission(member.id, { subjectId, payload: { actorName: 'Second Actor' } }),
  ]);
  const [refreshed] = await rows(member.id);
  expect(await rows(member.id)).toHaveLength(1);
  expect(refreshed?.id).toBe(first.id);
  expect(refreshed?.payload).toEqual({ actorName: 'Second Actor' });
  expect(refreshed?.createdAt.getTime()).toBeGreaterThan(aged);
  await markRead(db(), member.id, first.id);
  await insertNotifications(db(), [emission(member.id, { subjectId })]);
  expect(await rows(member.id)).toHaveLength(2);
  expect(await unreadOf(member.id)).toBe(1);
});
it('NOTIF-I04 NOTIF-B08 the feed and the count are scoped to the one reader, newest first', async () => {
  const { actor, member } = users();
  await insertNotifications(db(), [emission(actor.id)]);
  const mine = [emission(member.id), emission(member.id), emission(member.id)];
  await insertNotifications(db(), mine);
  const all = await rows(member.id);
  // Oldest first in the table, so the feed has to reverse them.
  await Promise.all(all.map((row, index) => age(row.id, 3 - index)));
  const page = await selectFeed(db(), member.id, 10, null);
  expect(page).toHaveLength(3);
  expect(page.every((row) => row.userId === member.id)).toBe(true);
  const times = page.map((row) => row.createdAt.getTime());
  expect(times).toEqual([...times].sort((a, b) => b - a));
  expect(await unreadOf(member.id)).toBe(3);
  expect(await unreadOf(actor.id)).toBe(1);
  // The limit is honoured and a cursor continues strictly before the page's last row.
  const first = await selectFeed(db(), member.id, 2, null);
  expect(first).toHaveLength(2);
  const rest = await selectFeed(db(), member.id, 2, first[1] ?? null);
  expect(rest.map((row) => row.id)).toEqual([page[2]?.id]);
});
it('NOTIF-B14 the feed narrows to unread rows and to a set of kinds', async () => {
  const { member } = users();
  await insertNotifications(db(), [
    emission(member.id),
    emission(member.id, { kind: 'note.mentioned', subjectType: 'notes' }),
    emission(member.id, { kind: 'kpi.off_target', subjectType: 'kpis' }),
  ]);
  const [first] = await rows(member.id);
  if (!first) throw new Error('no row');
  await markRead(db(), member.id, first.id);
  const unread = await selectFeed(db(), member.id, 10, null, { unread: true });
  expect(unread.map((row) => row.id)).not.toContain(first.id);
  expect(unread).toHaveLength(2);
  const notes = await selectFeed(db(), member.id, 10, null, { kinds: ['note.mentioned'] });
  expect(notes.map((row) => row.kind)).toEqual(['note.mentioned']);
  expect(await selectUnread(db(), member.id)).toHaveLength(2);
  expect(await countRead(db(), member.id)).toBe(1);
  expect(await countRead(db(), member.id, [first.kind])).toBe(1);
  expect(await countRead(db(), member.id, ['no.such_kind'])).toBe(0);
});
it('NOTIF-B06 rows created in the same millisecond are never skipped at a page boundary', async () => {
  const { member } = users();
  await insertNotifications(db(), [emission(member.id), emission(member.id), emission(member.id)]);
  // One transaction emitting several notifications stamps them alike.
  await db()
    .update(notifications)
    .set({ createdAt: new Date('2026-10-01T09:00:00.000Z') });
  const seen: string[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;
  for (let page = 0; page < 3; page++) {
    const rows = await selectFeed(db(), member.id, 1, cursor);
    seen.push(...rows.map((row) => row.id));
    cursor = rows.at(-1) ?? null;
  }
  expect(new Set(seen).size).toBe(3);
});
it('NOTIF-B07 NOTIF-I04 marking read answers only the reader own unread rows', async () => {
  const { actor, member } = users();
  await insertNotifications(db(), [emission(member.id), emission(member.id)]);
  const [one, two] = await rows(member.id);
  if (!one || !two) throw new Error('no rows');
  // Another reader's id is not found, not forbidden: there is nothing to see.
  expect(await markRead(db(), actor.id, one.id)).toBeNull();
  const marked = await markRead(db(), member.id, one.id);
  expect(marked?.id).toBe(one.id);
  expect(marked?.readAt).toBeInstanceOf(Date);
  // Read is not reversible and not repeatable: a second mark finds no unread row.
  expect(await markRead(db(), member.id, one.id)).toBeNull();
  // Mark-many ignores ids already read, ids of another reader, and ids that do not exist.
  expect(await markManyRead(db(), actor.id, [two.id])).toBe(0);
  expect(await markManyRead(db(), member.id, [one.id, two.id, id()])).toBe(1);
  expect(await markManyRead(db(), member.id, [])).toBe(0);
  expect(await unreadOf(member.id)).toBe(0);
});
it('NOTIF-B10 expiry deletes read rows past one window and unread rows past a longer one', async () => {
  const { member } = users();
  await insertNotifications(db(), [
    emission(member.id),
    emission(member.id),
    emission(member.id),
    emission(member.id),
  ]);
  const [readOld, readNew, unreadOld, unreadNew] = await rows(member.id);
  if (!readOld || !readNew || !unreadOld || !unreadNew) throw new Error('no rows');
  const now = Date.now();
  const stamp = (row: { id: string }, fields: { createdAt?: Date; readAt?: Date }) =>
    db().update(notifications).set(fields).where(eq(notifications.id, row.id));
  await stamp(readOld, { readAt: new Date(now - 40 * 24 * hour) });
  await stamp(readNew, { readAt: new Date(now - 20 * 24 * hour) });
  await stamp(unreadOld, { createdAt: new Date(now - 200 * 24 * hour) });
  await stamp(unreadNew, { createdAt: new Date(now - 100 * 24 * hour) });
  const deleted = await deleteExpired(
    db(),
    new Date(now - 30 * 24 * hour),
    new Date(now - 180 * 24 * hour),
  );
  expect(deleted).toBe(2);
  expect((await rows(member.id)).map((row) => row.id).sort()).toEqual(
    [readNew.id, unreadNew.id].sort(),
  );
});
