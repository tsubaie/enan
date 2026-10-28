import 'server-only';
import type { Context } from '@/core/auth/session';
import type { NotificationSubject } from '@/core/modules/server-manifest';
import { emit } from '@/core/notifications/emit';
import { markSubjectRead } from '@/core/db/notifications-repo';
import { routes } from '@/core/routes';
import { userIdsForPeople } from '@/modules/people';
import * as repo from './repo';
// ADR 0022: the kinds this module emits, and how its subject is drawn in the feed. KPIS-B30: a
// reading-due line opens the record with its reading dialog already open.
export const kinds = ['kpi.off_target', 'kpi.reading_due'];
export async function resolve(ctx: Context, ids: readonly string[]) {
  const rows = await repo.selectKpiSubjects(ctx.db, ids);
  return new Map<string, NotificationSubject>(
    rows.map((row) => [
      row.id,
      {
        title: row.title,
        href: routes.kpis({ id: row.id }),
        hrefs: { 'kpi.reading_due': routes.kpis({ id: row.id, action: 'recordReading' }) },
      },
    ]),
  );
}
// KPIS-B30, NOTIF-B17: a reading recorded answers the reminders about the measure, for everyone.
export const clearReadingNotices = (ctx: Context, kpiId: string) =>
  markSubjectRead(ctx.db, ['kpi.reading_due', 'kpi.off_target'], kpiId);
type Measured = { id: string; ownerId: string | null; meta: { status: string } };
// NOTIF-B04 `kpi.off_target`: a reading that takes the measure off target, where it was not before,
// tells its owner, in the reading's own transaction. Returns the measure after, for the caller.
export async function notifyOffTarget<T extends Measured>(
  ctx: Context,
  before: Measured,
  after: T,
) {
  if (after.meta.status === 'off_target' && before.meta.status !== 'off_target' && after.ownerId)
    await emit(ctx, {
      kind: 'kpi.off_target',
      subjectType: 'kpis',
      subjectId: after.id,
      to: await userIdsForPeople(ctx, [after.ownerId]),
    });
  return after;
}
