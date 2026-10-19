import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { constraintViolation } from '@/core/db/errors';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { harness, workspaceToday } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
// The constraint SQLite reported, or null when the statement went through (ADR 0029).
const violation = <T>(statement: Promise<T>) =>
  statement.then(
    () => null,
    (error: Error) => constraintViolation(error),
  );
const reading = (kpiId: string, day: string, value = 1) =>
  db().run(
    sql`insert into kpi_readings (id, kpi_id, reading_date, value) values (${id()}, ${kpiId}, ${day}, ${value})`,
  );
const target = (kpiId: string, year: number, period: number, value = 1) =>
  db().run(
    sql`insert into kpi_targets (id, kpi_id, year, period, target_value) values (${id()}, ${kpiId}, ${year}, ${period}, ${value})`,
  );
it('KPIS-I01 the database keeps one live reading per KPI per date', async () => {
  const today = await workspaceToday();
  const kpi = await harness.kpi('Guarded');
  await expect(reading(kpi.id, today)).resolves.toBeTruthy();
  expect(await violation(reading(kpi.id, today, 2))).toMatchObject({
    kind: 'unique',
    columns: ['kpi_readings.kpi_id', 'kpi_readings.reading_date'],
  });
  // The index is partial, so a deleted reading leaves the date free again.
  await db().run(
    sql`update kpi_readings set deleted_at = ${Date.now()}, deleted_op_id = ${id()} where kpi_id = ${kpi.id}`,
  );
  await expect(reading(kpi.id, today, 2)).resolves.toBeTruthy();
});
it('KPIS-I02 the database keeps one live target per KPI per period and rejects a thirteenth', async () => {
  const kpi = await harness.kpi('Targeted');
  await expect(target(kpi.id, 2026, 3)).resolves.toBeTruthy();
  expect(await violation(target(kpi.id, 2026, 3, 2))).toMatchObject({
    kind: 'unique',
    columns: ['kpi_targets.kpi_id', 'kpi_targets.year', 'kpi_targets.period'],
  });
  expect(await violation(target(kpi.id, 2026, 13))).toMatchObject({
    kind: 'check',
    constraint: 'kpi_targets_period_check',
  });
  // Twelve is a month of a monthly KPI, so the column has to reach it.
  await expect(target(kpi.id, 2026, 12)).resolves.toBeTruthy();
  await expect(target(kpi.id, 2026, 4, -5)).resolves.toBeTruthy();
});
it('KPIS-I01 KPIS-I02 values outside the documented magnitude are rejected by the database', async () => {
  const today = await workspaceToday();
  const kpi = await harness.kpi('Bounded');
  // docs/03 § Numbers: the value is a REAL, so the magnitude limit is the CHECK alone. The largest
  // reading the limit admits is accepted and anything at or past it is refused.
  await expect(reading(kpi.id, today, 9_999_999_999.9999)).resolves.toBeTruthy();
  expect(await violation(reading(kpi.id, '2020-01-01', 10_000_000_000))).toMatchObject({
    kind: 'check',
    constraint: 'kpi_readings_value_check',
  });
  expect(await violation(target(kpi.id, 2026, 1, -10_000_000_000))).toMatchObject({
    kind: 'check',
    constraint: 'kpi_targets_value_check',
  });
  await expect(target(kpi.id, 2026, 2, -9_999_999_999.9999)).resolves.toBeTruthy();
});
it('KPIS-B01 KPIS-B06 the database holds the direction, cadence and unit a KPI is read by', async () => {
  const insert = (column: string, value: string) =>
    db().run(
      sql`insert into kpis (id, name, ${sql.raw(column)}) values (${id()}, 'Checked', ${value})`,
    );
  expect(await violation(insert('direction', 'sideways'))).toMatchObject({
    kind: 'check',
    constraint: 'kpis_direction_check',
  });
  expect(await violation(insert('frequency', 'weekly'))).toMatchObject({
    kind: 'check',
    constraint: 'kpis_frequency_check',
  });
  expect(await violation(insert('unit', 'widgets'))).toMatchObject({
    kind: 'check',
    constraint: 'kpis_unit_check',
  });
  await expect(insert('direction', 'lower')).resolves.toBeTruthy();
});
it('KPIS-I03 a KPI cannot be hard-deleted while its children exist except by cascade', async () => {
  const today = await workspaceToday();
  const kpi = await harness.kpi('Cascading');
  await reading(kpi.id, today);
  await target(kpi.id, 2026, 1);
  await db().run(sql`delete from kpis where id = ${kpi.id}`);
  const row = await db().get<{ count: number }>(
    sql`select (select count(*) from kpi_readings) + (select count(*) from kpi_targets) as count`,
  );
  expect(row?.count).toBe(0);
});
