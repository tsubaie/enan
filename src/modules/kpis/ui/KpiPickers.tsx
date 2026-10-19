'use client';
import { useState, type ComponentProps } from 'react';
import { useTranslations } from 'next-intl';
import { Segmented } from '@/ui/primitives/segmented';
import { Input } from '@/ui/primitives/input';
import { cn } from '@/ui/cn';
import type { Direction, KpiPatch, Unit } from '../schema/validation';
import { unitIcons, useKpiLabels } from './use-kpi-labels';
type Save = (patch: Omit<KpiPatch, 'revision'>) => void;
// Which way is good is a choice between two values worth seeing together, so it is the capsule
// segmented control (docs/design-system.md § Segmented controls), the shape a person's type takes.
// The hidden input keeps the value in the create form's post.
export function DirectionToggle({ value, save }: { value: Direction; save?: Save | undefined }) {
  const t = useTranslations('kpis');
  const [direction, setDirection] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDirection(value);
  }
  return (
    <>
      <input type="hidden" name="direction" value={direction} />
      <Segmented
        label={t('direction')}
        value={direction}
        segments={[
          { value: 'higher', label: t('higherShort') },
          { value: 'lower', label: t('lowerShort') },
        ]}
        onChange={(next) => {
          setDirection(next);
          save?.({ direction: next });
        }}
      />
    </>
  );
}
export function UnitOption({ unit }: { unit: Unit }) {
  const labels = useKpiLabels();
  const Icon = unitIcons[unit];
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden={true} />
      {labels.unit(unit)}
    </span>
  );
}
// KPIS-B28: a reading or a target is typed as a number with its unit beside it, so a percentage
// field ends in % the way the value reads everywhere else. A number reads left to right in both
// languages, so the field does too, with the mark after the digits; a plain count has no mark.
export function AmountInput({
  unit,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, 'dir' | 'inputMode'> & { unit: Unit }) {
  const labels = useKpiLabels();
  const symbol = labels.symbol(unit);
  return (
    <span dir="ltr" className={cn('relative flex min-w-0 items-center', className)}>
      <Input
        {...props}
        dir="ltr"
        inputMode="decimal"
        autoComplete="off"
        className={cn('text-start tabular-nums', symbol && 'pe-9')}
      />
      {symbol && (
        <span
          aria-hidden
          className="pointer-events-none absolute end-2.5 text-sm font-light text-text-muted"
        >
          {symbol}
        </span>
      )}
    </span>
  );
}
