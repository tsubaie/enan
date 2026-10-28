import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/client';
import { kpis } from '../schema/db';
type Range = { from: string; to: string };
export type Ranges = Record<'monthly' | 'quarterly' | 'annual', Range>;
// The login behind a measure's owner: a live directory record linked to an active account.
const ownerLogin = sql<string | null>`(select u.id from people p join users u on u.id = p.user_id
  where p.id = ${kpis.ownerId} and p.deleted_at is null and u.deleted_at is null and u.is_active = 1)`;
const bound = (ranges: Ranges, end: keyof Range) => sql`case ${kpis.frequency}
  when 'monthly' then ${ranges.monthly[end]}
  when 'quarterly' then ${ranges.quarterly[end]}
  else ${ranges.annual[end]} end`;
// KPIS-B30: the live measures, reminders on, held by somebody with a login, that have no reading
// dated inside the period they are in now. `ranges` carries each cadence's current period.
export function selectReadingsDue(database: Database, ranges: Ranges) {
  return database
    .select({ id: kpis.id, frequency: kpis.frequency, userId: ownerLogin })
    .from(kpis)
    .where(
      and(
        isNull(kpis.deletedAt),
        eq(kpis.remindersEnabled, true),
        sql`${ownerLogin} is not null`,
        sql`not exists (select 1 from kpi_readings r where r.kpi_id = ${kpis.id}
          and r.deleted_at is null
          and r.reading_date between ${bound(ranges, 'from')} and ${bound(ranges, 'to')})`,
      ),
    )
    .orderBy(kpis.id);
}
