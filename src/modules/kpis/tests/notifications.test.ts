import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { notifications } from '@/core/db/system-schema';
import { getSetting } from '@/core/db/settings-repo';
import { periodOf } from '@/core/time/kpis';
import { addDays, dayAt } from '@/core/time/tasks';
import { harness } from '@/modules/notifications/tests/fixtures';
import { addReading, createKpi, putTargets } from '../service';
import { KpiCreate, ReadingCreate, TargetsPut } from '../schema/validation';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
const offTarget = async () =>
  (await db().select().from(notifications)).filter((row) => row.kind === 'kpi.off_target');
it('NOTIF-B04 a reading that takes a measure off target tells its owner, once, and never the one who recorded it', async () => {
  const member = harness.member;
  if (!member) throw new Error('harness');
  const owner = await harness.personFor(member, 'Receiving Member');
  const today = dayAt(await getSetting(db(), 'workspace.timezone'));
  const { year, period } = periodOf(today, 'quarterly');
  const kpi = await harness.run((ctx) =>
    createKpi(ctx, KpiCreate.parse({ name: 'Board pack on time', ownerId: owner.id })),
  );
  await harness.run((ctx) =>
    putTargets(ctx, kpi.id, TargetsPut.parse({ items: [{ year, period, targetValue: 100 }] })),
  );
  const record = (readingDate: string, value: number) =>
    harness.run((ctx) => addReading(ctx, kpi.id, ReadingCreate.parse({ readingDate, value })));
  await record(today, 40);
  expect((await offTarget()).map((row) => [row.userId, row.subjectId])).toEqual([
    [member.id, kpi.id],
  ]);
  await db().update(notifications).set({ readAt: new Date() });
  // Already off target: another low reading is not news.
  await record(addDays(today, -1), 30);
  expect((await offTarget()).filter((row) => !row.readAt)).toHaveLength(0);
});
