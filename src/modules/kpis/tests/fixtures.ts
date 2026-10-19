import { createHarness } from '@/core/db/test-harness';
import { db } from '@/core/db/client';
import { dayAt } from '@/core/time/days';
import { getSetting } from '@/core/db/settings-repo';
import { KpiCreate, ObjectiveCreate, ReadingCreate } from '../schema/validation';
import * as service from '../service';
// Shared harness for the scorecard scenarios: a clean database, one admin actor, and factories
// that go through the services so every row carries provenance and every invariant is exercised.
const base = createHarness({ name: 'Scorecard Tester', email: 'kpis@example.test' });
export const harness = {
  get user() {
    return base.user;
  },
  run: base.run,
  reset: base.reset,
  kpi(name: string, fields: Partial<KpiCreate> = {}) {
    return harness.run((ctx) => service.createKpi(ctx, KpiCreate.parse({ name, ...fields })));
  },
  objective(name: string, fields: Partial<ObjectiveCreate> = {}) {
    return harness.run((ctx) =>
      service.createObjective(ctx, ObjectiveCreate.parse({ name, ...fields })),
    );
  },
  reading(kpiId: string, readingDate: string, value: number, note = '') {
    return harness.run((ctx) =>
      service.addReading(ctx, kpiId, ReadingCreate.parse({ readingDate, value, note })),
    );
  },
  targets(kpiId: string, items: { year: number; period: number; targetValue: number }[]) {
    return harness.run((ctx) => service.putTargets(ctx, kpiId, { items }));
  },
};
export async function workspaceToday() {
  return dayAt(await getSetting(db(), 'workspace.timezone'));
}
