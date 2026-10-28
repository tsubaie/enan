'use client';
import { useTranslations } from 'next-intl';
import { periodOf, shiftPeriod } from '@/core/time/kpis';
import { cn } from '@/ui/cn';
import { useKpiLabels } from './use-kpi-labels';
import type { KpiDetail } from '../schema/validation';
const TRAILING = 3;
// KPIS-B30: the three periods before the one being recorded, each at its own latest reading, so the
// owner types the new figure against what came before it rather than from memory. A period with no
// reading says N/A rather than borrowing a neighbour's figure (KPIS-B31).
export function TrailingStrip({ kpi, day }: { kpi: KpiDetail; day: string }) {
  const t = useTranslations('kpis');
  const labels = useKpiLabels();
  const at = periodOf(day, kpi.frequency);
  const periods = Array.from({ length: TRAILING }, (_, index) =>
    shiftPeriod(at, index - TRAILING, kpi.frequency),
  ).map((period) => {
    // Readings arrive newest first, so the first one inside the period stands for it.
    const reading = kpi.readings.find((row) => {
      const of = periodOf(row.readingDate, kpi.frequency);
      return of.year === period.year && of.period === period.period;
    });
    return { period, value: reading?.value ?? null };
  });
  const top = Math.max(...periods.map((row) => Math.abs(row.value ?? 0)), 1);
  return (
    <ol aria-label={t('trailingPeriods')} className="m-0 grid list-none grid-cols-3 gap-2 p-0">
      {periods.map(({ period, value }) => (
        <li key={`${period.year}-${period.period}`} className="grid gap-1 text-xs">
          <svg width={48} height={20} viewBox="0 0 48 20" aria-hidden={true}>
            <rect
              x={0}
              y={value === null ? 18 : 20 - (18 * Math.abs(value)) / top}
              width={48}
              height={value === null ? 2 : (18 * Math.abs(value)) / top}
              rx={2}
              className={value === null ? 'fill-border' : 'fill-accent'}
            />
          </svg>
          <span className="text-text-muted">{labels.period(period, kpi.frequency)}</span>
          <bdi
            dir="ltr"
            className={cn('font-medium tabular-nums', value === null && 'text-text-muted')}
          >
            {value === null ? t('notAvailable') : labels.value(value, kpi.unit)}
          </bdi>
        </li>
      ))}
    </ol>
  );
}
// The distance between the figure being typed and the target of the period it is dated in, live.
// Good or bad follows the direction the KPI is meant to move, never the sign.
export function TargetDelta({ kpi, day, value }: { kpi: KpiDetail; day: string; value: string }) {
  const t = useTranslations('kpis');
  const labels = useKpiLabels();
  const at = periodOf(day, kpi.frequency);
  const target = kpi.targets.find((row) => row.year === at.year && row.period === at.period);
  const typed = Number(value);
  if (!target || value.trim() === '' || !Number.isFinite(typed)) return null;
  const delta = typed - target.targetValue;
  const sign = delta > 0 ? '+' : '';
  return (
    <p
      role="status"
      className={cn('m-0 text-xs font-medium', labels.changeInk(delta, kpi.direction))}
    >
      {t('targetDelta', {
        delta: `${sign}${labels.value(delta, kpi.unit)}`,
        target: labels.value(target.targetValue, kpi.unit),
      })}
    </p>
  );
}
