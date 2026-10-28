import 'server-only';
import { and, eq, gte, isNull, isNotNull, lt, or, sql, desc, inArray, count } from 'drizzle-orm';
import { notifications } from './system-schema';
import { type Database } from './client';
import { id } from './ids';
import type { Json } from './audit-repo';
// ADR 0022 keeps the table in core: core owns the rows, the read state and the feed query, and
// never learns what a task is. Modules contribute kinds and resolve subjects.
export type Emission = {
  userId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  payload: Json;
  actorId: string | null;
};
// NOTIF-I02/B03: the partial unique index makes this an upsert. Re-notifying an **unread** subject
// moves it back to the top and replaces the payload; once read, the conflict target no longer
// matches and a new row is inserted, because it is news again.
export async function insertNotifications(database: Database, rows: readonly Emission[]) {
  if (!rows.length) return 0;
  const values = rows.map((row) => ({ id: id(), ...row }));
  const written = await database
    .insert(notifications)
    .values(values)
    .onConflictDoUpdate({
      target: [notifications.userId, notifications.kind, notifications.subjectId],
      targetWhere: isNull(notifications.readAt),
      set: {
        createdAt: new Date(),
        payload: sql`excluded.payload`,
        actorId: sql`excluded.actor_id`,
      },
    })
    .returning({ id: notifications.id });
  return written.length;
}
export type FeedRow = Awaited<ReturnType<typeof selectFeed>>[number];
// NOTIF-B14: the page's filters, both optional. The kinds are the module's; core only matches them.
export type FeedFilter = { unread?: boolean; kinds?: readonly string[] | null };
// NOTIF-I04: scoped by the user id from `ctx`, never from a parameter the caller chose.
// Newest first, ties broken by id: one transaction can emit several rows in the same millisecond,
// and a cursor on the time alone would skip whichever of them fell past a page boundary.
export async function selectFeed(
  database: Database,
  userId: string,
  limit: number,
  before: { createdAt: Date; id: string } | null,
  filter: FeedFilter = {},
) {
  return database
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        filter.unread ? isNull(notifications.readAt) : undefined,
        filter.kinds ? inArray(notifications.kind, [...filter.kinds]) : undefined,
        before
          ? or(
              lt(notifications.createdAt, before.createdAt),
              and(eq(notifications.createdAt, before.createdAt), lt(notifications.id, before.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
}
// NOTIF-B08/B15: every unread row the reader has, so the badge and "mark all as read" can resolve
// them all; the rows whose subject has gone are left out by the service, which alone can tell.
// The unread index (NOTIF-I02) and retention (NOTIF-B10) bound how many there are.
export async function selectUnread(database: Database, userId: string) {
  return database
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
// NOTIF-B06/B15: the read rows of the kinds asked for, counted rather than resolved, so a poll
// never loads the whole feed to show a total.
export async function countRead(
  database: Database,
  userId: string,
  kinds: readonly string[] | null = null,
) {
  const [row] = await database
    .select({ count: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNotNull(notifications.readAt),
        kinds ? inArray(notifications.kind, [...kinds]) : undefined,
      ),
    );
  return row?.count ?? 0;
}
export async function markRead(database: Database, userId: string, notificationId: string) {
  const [row] = await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id, readAt: notifications.readAt });
  return row ?? null;
}
// NOTIF-B07: "mark all" marks exactly the rows the reader could see, which the service resolves
// first — a notification whose subject has gone is not something they were shown.
export async function markManyRead(database: Database, userId: string, ids: readonly string[]) {
  if (!ids.length) return 0;
  const rows = await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        inArray(notifications.id, [...ids]),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
// NOTIF-B17: the event a notification reported has been dealt with — a reading was recorded — so
// every reader's unread line about it is cleared, not only the actor's.
export async function markSubjectRead(
  database: Database,
  kinds: readonly string[],
  subjectId: string,
) {
  const rows = await database
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.subjectId, subjectId),
        inArray(notifications.kind, [...kinds]),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
// NOTIF-B05: the subjects already told of `kind` since a moment, read or not, so a reminder that
// is once per period stays once per period after its reader has dismissed it.
export async function selectNotifiedSince(
  database: Database,
  kind: string,
  subjectIds: readonly string[],
  since: Date,
) {
  if (!subjectIds.length) return new Set<string>();
  const rows = await database
    .select({ subjectId: notifications.subjectId })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, kind),
        inArray(notifications.subjectId, [...subjectIds]),
        gte(notifications.createdAt, since),
      ),
    );
  return new Set(rows.map((row) => row.subjectId));
}
// NOTIF-B10: retention. Read rows go after one window, unread after a longer one.
export async function deleteExpired(database: Database, readBefore: Date, unreadBefore: Date) {
  const rows = await database
    .delete(notifications)
    .where(
      or(
        and(isNotNull(notifications.readAt), lt(notifications.readAt, readBefore)),
        and(isNull(notifications.readAt), lt(notifications.createdAt, unreadBefore)),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
