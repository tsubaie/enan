import {
  periodIndex,
  periodOf,
  periodRange,
  periodsBehind,
  shiftPeriod,
  type Period,
} from '@/core/time/kpis';
import type { StatusThresholds } from '@/core/config/settings';
import {
  Direction,
  Frequency,
  type KpiMeta,
  type KpiStatus,
  type Point,
} from './schema/validation';
// ── The scorecard's arithmetic ────────────────────────────────────────────────────────────────
// KPIS-B01–B04 are pure functions of facts the repo reads, so they live beside the schemas that
// name those facts: one definition shared by the list, the detail, Home and the tests, with no
// database or request in scope. Statuses are never stored; every read recomputes them.
export type PeriodTarget = { year: number; period: number; value: number };
export type StatusInput = {
  current: number | null;
  currentDate: string | null;
  target: number | null;
  direction: Direction;
  frequency: Frequency;
  thresholds: StatusThresholds;
  today: string;
};
const meets = (current: number, target: number, direction: Direction) =>
  direction === 'higher' ? current >= target : current <= target;
// The ratio bands, read in the direction the KPI is meant to move.
function banded(
  ratio: number,
  direction: Direction,
  band: { on: number; near: number },
): KpiStatus {
  const inside = direction === 'higher' ? ratio >= band.on : ratio <= band.on;
  const close = direction === 'higher' ? ratio >= band.near : ratio <= band.near;
  return inside ? 'on_target' : close ? 'near_target' : 'off_target';
}
export function computeKpiStatus(input: StatusInput): KpiStatus {
  const { current, currentDate, target, direction, thresholds } = input;
  if (current === null || currentDate === null) return 'no_data';
  // One missed report is lag; more than one is nobody maintaining the measure (KPIS-B01).
  if (periodsBehind(currentDate, input.today, input.frequency) > 1) return 'stale';
  if (target === null) return 'no_target';
  // No "near" band without a ratio of same-signed values; both negative, the ratio is inverted.
  if (target === 0 || Math.sign(current) !== Math.sign(target))
    return meets(current, target, direction) ? 'on_target' : 'off_target';
  const ratio = target < 0 ? target / current : current / target;
  return banded(ratio, direction, thresholds[direction]);
}
// KPIS-B03: 100 percent means on target in both directions, so the ratio inverts with the
// direction. It is undefined where a ratio would be meaningless, and the gauge then shows the
// status badge alone.
export function achievementOf(current: number | null, target: number | null, direction: Direction) {
  if (current === null || target === null || target <= 0 || current <= 0) return null;
  return Math.min(direction === 'higher' ? current / target : target / current, 9.99);
}
export function percentChangeOf(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
// KPIS-B02: the current period's target, else the earliest future one, else none.
export function resolveEffectiveTarget(
  targets: PeriodTarget[],
  period: Period,
  frequency: Frequency,
) {
  const now = periodIndex(period, frequency);
  const chosen = targets
    .filter((target) => periodIndex(target, frequency) >= now)
    .sort((a, b) => periodIndex(a, frequency) - periodIndex(b, frequency))[0];
  return chosen ? { value: chosen.value, year: chosen.year, period: chosen.period } : null;
}
// Everything the row, the gauge and Home read, derived in one place from the facts the repository
// reads (KPIS-B01–B05). Statuses are never stored: a threshold change or a new period changes
// every answer, so each read recomputes them (KPIS-B10, KPIS-B11).
export type KpiFacts = {
  direction: string;
  frequency: string;
  current: Point | null;
  previousPeriodValue: number | null;
  sparkline: Point[];
  targets: PeriodTarget[];
  // The record's full history, where it has one; otherwise the sparkline is the history.
  readings?: Point[];
};
// The period is not part of the measurement context: each KPI is on its own cadence, so it is
// derived from the day and that KPI's frequency wherever it is needed.
export type MeasuredAt = { today: string; thresholds: StatusThresholds; offset?: number };
// KPIS-B31: the figure a period is read at is the last reading dated inside it, never an older
// one carried forward. Facts with no history at all (a bare current reading) keep that reading.
export function periodValue(facts: KpiFacts, at: Period, today: string) {
  const history = facts.readings ?? facts.sparkline;
  if (!history.length) return facts.current?.value ?? null;
  const { from, to } = periodRange(at, Frequency.parse(facts.frequency));
  const inside = history.filter(
    (point) => point.date >= from && point.date <= to && point.date <= today,
  );
  return (
    inside.reduce<Point | null>(
      (last, point) => (!last || point.date >= last.date ? point : last),
      null,
    )?.value ?? null
  );
}
// A shifted period is read at its own figure and against its own target, without freshness.
type Reading = { value: number | null; achievement: number | null; status: KpiStatus };
function neighbour(
  facts: KpiFacts,
  at: MeasuredAt,
  period: Period,
  target: number | null,
): Reading {
  const direction = Direction.parse(facts.direction);
  const value = periodValue(facts, period, at.today);
  if (value === null) return { value, achievement: null, status: 'no_data' };
  return {
    value,
    achievement: achievementOf(value, target, direction),
    status: computeKpiStatus({
      current: value,
      currentDate: at.today,
      target,
      direction,
      frequency: Frequency.parse(facts.frequency),
      thresholds: at.thresholds,
      today: at.today,
    }),
  };
}
// KPIS-B26: a shifted reading names its own period's target exactly; the effective one rolls
// forward to the nearest plan.
function targetAt(facts: KpiFacts, at: MeasuredAt, frequency: Frequency) {
  const period = shiftPeriod(periodOf(at.today, frequency), at.offset ?? 0, frequency);
  const target = at.offset
    ? (facts.targets.find((row) => row.year === period.year && row.period === period.period) ??
      null)
    : resolveEffectiveTarget(facts.targets, period, frequency);
  return { period, target };
}
// The effective period's answer: the current reading against its target, with freshness.
function effective(facts: KpiFacts, at: MeasuredAt, target: number | null): Reading {
  const current = facts.current?.value ?? null;
  const direction = Direction.parse(facts.direction);
  const status = computeKpiStatus({
    current,
    currentDate: facts.current?.date ?? null,
    target,
    direction,
    frequency: Frequency.parse(facts.frequency),
    thresholds: at.thresholds,
    today: at.today,
  });
  // KPIS-B31: a stale reading is not progress against today's target, so the arc stays empty.
  const counts = status !== 'stale' && status !== 'no_data';
  return {
    value: current,
    achievement: counts ? achievementOf(current, target, direction) : null,
    status,
  };
}
export function deriveMeta(facts: KpiFacts, at: MeasuredAt): KpiMeta {
  const current = facts.current?.value ?? null;
  const frequency = Frequency.parse(facts.frequency);
  // KPIS-B26: `at.offset` reads the whole scorecard against a neighbouring period, named exactly
  // and without freshness, for the reasons the spec gives.
  const { period, target } = targetAt(facts, at, frequency);
  const value = target?.value ?? null;
  const reading = at.offset ? neighbour(facts, at, period, value) : effective(facts, at, value);
  return {
    current,
    currentDate: facts.current?.date ?? null,
    previous: facts.previousPeriodValue,
    percentChange: percentChangeOf(current, facts.previousPeriodValue),
    effectiveTarget: value,
    effectiveTargetPeriod: target ? { year: target.year, period: target.period } : null,
    status: reading.status,
    achievement: reading.achievement,
    sparkline: facts.sparkline,
  };
}
// KPIS-B08: what the record would read as against the period before the effective one and the one
// after it. Freshness is deliberately not applied to the neighbours: the question they answer is
// "was this target met", which does not go stale, and the middle entry carries the KPI's own answer
// so the record and the row never disagree. KPIS-B31: each neighbour is read at its own reading.
export function derivePeriods(facts: KpiFacts, at: MeasuredAt, base: Period, meta: KpiMeta) {
  const frequency = Frequency.parse(facts.frequency);
  const targetIn = ({ year, period }: Period) =>
    facts.targets.find((row) => row.year === year && row.period === period)?.value ?? null;
  const before = shiftPeriod(periodOf(at.today, frequency), -1, frequency);
  return {
    periods: [-1, 0, 1].map((offset) => {
      const slot = shiftPeriod(base, offset, frequency);
      const target = targetIn(slot);
      const own =
        offset === 0
          ? { value: meta.current, achievement: meta.achievement, status: meta.status }
          : neighbour(facts, at, slot, target);
      return { ...slot, target, ...own };
    }),
    // KPIS-B04: the period before this one, read at its own last reading rather than at today's.
    previousPeriod: { ...before, value: facts.previousPeriodValue, target: targetIn(before) },
  };
}
// KPIS-B07: the default sort puts what needs attention first. "No target" outranks "on target"
// because a KPI nobody has set a target for is unanswered, not healthy.
export const severityRank: Record<KpiStatus, number> = {
  off_target: 0,
  stale: 1,
  no_data: 2,
  near_target: 3,
  no_target: 4,
  on_target: 5,
};
export const attentionStatuses: readonly KpiStatus[] = ['off_target', 'stale', 'no_data'];
