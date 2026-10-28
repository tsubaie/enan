import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { notifications } from '@/core/db/system-schema';
import { periodRange, periodOf, shiftPeriod } from '@/core/time/kpis';
import { harness } from '@/modules/notifications/tests/fixtures';
import { feed } from '@/modules/notifications/service';
import { addReading, createKpi, patchKpi } from '../service';
import { KpiCreate, ReadingCreate } from '../schema/validation';
import { remindReadingsDue, periodLabel } from '../reminders/service';
import { kpiJobs } from '../jobs';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
const TODAY = '2026-09-10';
const due = async () =>
  (await db().select().from(notifications)).filter((row) => row.kind === 'kpi.reading_due');
const remind = (today = TODAY) =>
  withTransaction(db(), (database) => remindReadingsDue(database, today));
async function ownedKpi(fields: Partial<KpiCreate> = {}) {
  const member = harness.member;
  if (!member) throw new Error('harness');
  const owner = await harness.personFor(member, 'Receiving Member');
  const kpi = await harness.run((ctx) =>
    createKpi(ctx, KpiCreate.parse({ name: 'Board pack on time', ownerId: owner.id, ...fields })),
  );
  return { kpi, member };
}
it('KPIS-B30 a measure with no reading this period tells its owner once, with the period named', async () => {
  const { kpi, member } = await ownedKpi({ frequency: 'quarterly' });
  expect(await remind()).toEqual({ notified: 1, skipped: 0 });
  const [row] = await due();
  expect(row).toMatchObject({
    userId: member.id,
    subjectType: 'kpis',
    subjectId: kpi.id,
    actorId: null,
    payload: { periodLabel: 'Q3 2026', frequency: 'quarterly' },
  });
  // Read or not, the same period is never reminded twice.
  // Dated on the day the scheduler sent it, so the period boundaries below are what decide.
  await db()
    .update(notifications)
    .set({ readAt: new Date(), createdAt: new Date(`${TODAY}T05:00:00Z`) });
  expect(await remind()).toEqual({ notified: 0, skipped: 1 });
  expect(await due()).toHaveLength(1);
  // The next period is news again.
  const next = periodRange(shiftPeriod(periodOf(TODAY, 'quarterly'), 1, 'quarterly'), 'quarterly');
  expect(await remind(next.from)).toEqual({ notified: 1, skipped: 0 });
});
it('KPIS-B30 a reading dated inside the period, reminders off or an owner with no login send nothing', async () => {
  const { kpi } = await ownedKpi({ frequency: 'monthly' });
  await harness.run((ctx) =>
    addReading(ctx, kpi.id, ReadingCreate.parse({ readingDate: '2026-09-02', value: 5 })),
  );
  expect(await remind()).toEqual({ notified: 0, skipped: 0 });
  const quiet = await harness.run((ctx) =>
    createKpi(
      ctx,
      KpiCreate.parse({ name: 'Quiet', ownerId: kpi.ownerId, remindersEnabled: false }),
    ),
  );
  expect(quiet.remindersEnabled).toBe(false);
  const stranger = await harness.unlinkedPerson('No Login');
  await harness.run((ctx) =>
    createKpi(ctx, KpiCreate.parse({ name: 'Unreached', ownerId: stranger.id })),
  );
  expect(await remind()).toEqual({ notified: 0, skipped: 0 });
  // Turning reminders back on is a patch like any other field.
  await harness.run((ctx) =>
    patchKpi(ctx, quiet.id, { remindersEnabled: true, revision: quiet.revision }),
  );
  expect(await remind()).toEqual({ notified: 1, skipped: 0 });
});
it('KPIS-B30 NOTIF-B17 recording a reading clears the reminder and opens the record at the reading dialog', async () => {
  const { kpi, member } = await ownedKpi();
  await remind();
  const page = await harness.run((ctx) => feed(ctx, 10, null), member);
  expect(page.items.map((item) => item.href)).toEqual([`/kpis?id=${kpi.id}&action=recordReading`]);
  await harness.run((ctx) =>
    addReading(ctx, kpi.id, ReadingCreate.parse({ readingDate: TODAY, value: 5 })),
  );
  expect((await due()).every((row) => row.readAt !== null)).toBe(true);
});
it('KPIS-B30 the scheduled job runs the reminders on the workspace day', async () => {
  await ownedKpi();
  const handler = kpiJobs['kpis.reminders'];
  if (!handler) throw new Error('job not registered');
  await withTransaction(db(), (database) =>
    handler.publish(database, { payload: {} } as never, { completed: true }),
  );
  expect(await due()).toHaveLength(1);
  expect(periodLabel({ year: 2026, period: 9 }, 'monthly')).toBe('2026-09');
  expect(periodLabel({ year: 2026, period: 1 }, 'annual')).toBe('2026');
});
