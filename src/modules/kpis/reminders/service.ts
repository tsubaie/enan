/** KPIS-B30: once per period, the owner of a measure with no reading for it is told so. */
import 'server-only';
import type { Database } from '@/core/db/client';
import { selectNotifiedSince } from '@/core/db/notifications-repo';
import { emitUnattended } from '@/core/notifications/emit';
import { dayValue } from '@/core/time/days';
import { periodOf, periodRange, type Period } from '@/core/time/kpis';
import { Frequency } from '../schema/validation';
import { selectReadingsDue } from './repo';
const cadences = Frequency.options;
// A label any reader can parse, whatever their language: the payload names the period it is for.
export function periodLabel({ year, period }: Period, frequency: Frequency) {
  if (frequency === 'monthly') return `${year}-${String(period).padStart(2, '0')}`;
  return frequency === 'quarterly' ? `Q${period} ${year}` : String(year);
}
// The scheduler runs this once a day. A measure already reminded this period — whether or not its
// owner has read the line since — is skipped, so the reminder comes once per period rather than
// every morning the reading stays missing.
export async function remindReadingsDue(database: Database, today: string) {
  const range = (frequency: Frequency) => periodRange(periodOf(today, frequency), frequency);
  const ranges = {
    monthly: range('monthly'),
    quarterly: range('quarterly'),
    annual: range('annual'),
  };
  const due = await selectReadingsDue(database, ranges);
  const told = await Promise.all(
    cadences.map((frequency) =>
      selectNotifiedSince(
        database,
        'kpi.reading_due',
        due.filter((row) => row.frequency === frequency).map((row) => row.id),
        new Date(dayValue(ranges[frequency].from)),
      ),
    ),
  );
  const send = due.filter((row) => row.userId && !told.some((set) => set.has(row.id)));
  await emitUnattended(
    database,
    send.map((row) => {
      const frequency = Frequency.parse(row.frequency);
      return {
        kind: 'kpi.reading_due',
        subjectType: 'kpis',
        subjectId: row.id,
        payload: { periodLabel: periodLabel(periodOf(today, frequency), frequency), frequency },
        to: row.userId ? [row.userId] : [],
      };
    }),
  );
  return { notified: send.length, skipped: due.length - send.length };
}
