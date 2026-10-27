import 'server-only';
import { transactional } from '@/core/db/transaction';
import type { Context } from '@/core/auth/session';
import { AppError } from '@/core/http/errors';
import { notificationContributors } from '@/core/modules/registry';
import { selectFeed, selectOwn, markRead, markManyRead } from '@/core/db/notifications-repo';
import { z } from 'zod';
import type { FeedFilter, FeedRow } from '@/core/db/notifications-repo';
import { NotificationKind, type Notification } from './schema/validation';
// ADR 0022. Core owns the rows, the read state and the feed; modules own the kinds and turn a
// subject id back into a title and a link.
// NOTIF-B06/B08: a page of the feed with its subjects resolved. Rows whose subject no longer
// resolves are dropped from `items` and subtracted from `unread`; they are not deleted, because
// the subject may be restored. The page is fetched slightly over-size so that dropping a few does
// not return a short page while more exist.
// One lookup per module rather than one per row: the page is grouped by subject type and each
// owning module is asked once for the ids it owns (NOTIF-B06).
async function resolveSubjects(
  ctx: Context,
  page: readonly { subjectType: string; subjectId: string }[],
) {
  const { resolvers } = notificationContributors();
  const byType = new Map<string, string[]>();
  for (const row of page)
    byType.set(row.subjectType, [...(byType.get(row.subjectType) ?? []), row.subjectId]);
  const subjects = new Map<string, { title: string; href: string }>();
  for (const [type, ids] of byType) {
    const resolve = resolvers.get(type);
    if (!resolve) continue;
    for (const [id, subject] of await resolve(ctx, ids)) subjects.set(`${type}:${id}`, subject);
  }
  return subjects;
}
// NOTIF-B06: a row becomes a line only if its subject still resolves. A kind the database holds
// but this build no longer declares is treated the same way -- dropped rather than rendered as
// something the reader cannot act on.
function draw(
  row: FeedRow,
  subjects: Map<string, { title: string; href: string }>,
): Notification | null {
  const subject = subjects.get(`${row.subjectType}:${row.subjectId}`);
  const kind = NotificationKind.safeParse(row.kind);
  if (!subject || !kind.success) return null;
  return {
    id: row.id,
    kind: kind.data,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    title: subject.title,
    href: subject.href,
    actorName: actorName(row.payload),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
// The cursor is the last row's time and id, so rows sharing a millisecond are never skipped.
const Cursor = z
  .string()
  .regex(/^[^_]+_[^_]+$/u)
  .transform((value) => value.split('_'))
  .pipe(z.tuple([z.iso.datetime().transform((at) => new Date(at)), z.uuid()]));
// NOTIF-B08/B15: the rows the reader can see, all of them rather than one page's worth.
async function visible(ctx: Context) {
  const rows = await selectOwn(ctx.db, ctx.user.id);
  const subjects = await resolveSubjects(ctx, rows);
  return rows.filter((row) => draw(row, subjects));
}
const matches = (row: FeedRow, filter: FeedFilter) =>
  (!filter.unread || !row.readAt) && (!filter.kinds || filter.kinds.includes(row.kind));
export async function feed(
  ctx: Context,
  limit: number,
  cursor: string | null,
  filter: FeedFilter = {},
) {
  const parsed = cursor === null ? null : Cursor.safeParse(cursor);
  if (parsed && !parsed.success) throw new AppError('validation_failed');
  const before = parsed?.data ? { createdAt: parsed.data[0], id: parsed.data[1] } : null;
  const rows = await selectFeed(ctx.db, ctx.user.id, limit + 1, before, filter);
  const page = rows.slice(0, limit);
  const subjects = await resolveSubjects(ctx, page);
  const items = page.flatMap((row) => draw(row, subjects) ?? []);
  const last = page.at(-1);
  const all = await visible(ctx);
  return {
    items,
    // NOTIF-B08: the badge counts every unread row, whatever the page is filtered to.
    unread: all.filter((row) => !row.readAt).length,
    totalCount: all.filter((row) => matches(row, filter)).length,
    nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  };
}
// The payload is written by the emitting service and read back out of jsonb, so it comes back as
// whatever was stored rather than as a type. It is parsed rather than asserted: a row written by
// an older build is then a missing actor, not a crash in the feed.
const Payload = z.object({ actorName: z.string() }).partial().catch({});
function actorName(payload: unknown) {
  return Payload.parse(payload).actorName ?? null;
}
export const readOne = transactional(async function readOne(ctx: Context, notificationId: string) {
  const row = await markRead(ctx.db, ctx.user.id, notificationId);
  if (!row) throw new AppError('not_found');
  return { id: row.id, readAt: row.readAt?.toISOString() ?? null };
});
// NOTIF-B07: exactly the rows the reader could see, however far down the feed, narrowed to the
// kinds the page is filtered to. A notification whose subject has gone is not something they were
// shown, so "mark all as read" leaves it.
export const readAll = transactional(async function readAll(
  ctx: Context,
  kinds: readonly string[] | null = null,
) {
  const unread = (await visible(ctx))
    .filter((row) => matches(row, { unread: true, kinds }))
    .map((row) => row.id);
  return { marked: await markManyRead(ctx.db, ctx.user.id, unread) };
});
