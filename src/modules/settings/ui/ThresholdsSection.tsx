'use client';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/ui/primitives/button';
import { RecordSection } from '@/ui/layout/Record';
import { useKpiLabels } from '@/modules/kpis/ui';
import { PercentInput, type Save, type SettingRow } from './SettingControls';
// KPIS-I04, KPIS-B01: where a reading turns from on target to near and from near to off, for each
// direction. Each direction reads as its three statuses, in the scorecard's own words and colours,
// with the boundaries typed as percentages of the target between them and a worked example for a
// target of 100 that follows the fields as they are typed. The setting keeps ratios.
const Band = z.object({ on: z.number(), near: z.number() });
const Bands = z.object({ higher: Band, lower: Band });
type Bands = z.infer<typeof Bands>;
type Direction = keyof Bands;
type Edge = keyof Bands['higher'];
type Status = 'on_target' | 'near_target' | 'off_target';
type Field = (edge: Edge, status: Status) => ReactNode;
type Rule = { status: Status; rule: ReactNode };
const EXAMPLE_TARGET = 100;
export function ThresholdsSection({
  row,
  save,
}: {
  row: (key: string) => SettingRow | undefined;
  save: Save;
}) {
  const t = useTranslations('admin');
  const setting = row('kpis.status_thresholds');
  const parsed = Bands.safeParse(setting?.value);
  const [drafts, setDrafts] = useState<Partial<Record<string, number>>>({});
  const [seen, setSeen] = useState(setting?.value);
  // A saved value replaces whatever was being typed: the fields reset to it themselves.
  if (seen !== setting?.value) {
    setSeen(setting?.value);
    setDrafts({});
  }
  if (!setting || !parsed.success) return null;
  const bands = parsed.data;
  const card = (direction: Direction) => {
    const live = (edge: Edge) => drafts[`${direction}-${edge}`] ?? bands[direction][edge];
    const field: Field = (edge, status) => (
      <PercentInput
        label={t('thresholdField', {
          direction: t(direction === 'higher' ? 'thresholdHigher' : 'thresholdLower'),
          status: t(status === 'on_target' ? 'thresholdOnStart' : 'thresholdNearStart'),
        })}
        value={bands[direction][edge]}
        onDraft={(ratio) =>
          setDrafts((current) => ({ ...current, [`${direction}-${edge}`]: ratio ?? undefined }))
        }
        commit={(ratio) =>
          save({
            key: setting.key,
            value: { ...bands, [direction]: { ...bands[direction], [edge]: ratio } },
          })
        }
      />
    );
    return (
      <DirectionCard direction={direction} on={live('on')} near={live('near')} field={field} />
    );
  };
  return (
    <RecordSection
      title={t('settingsKpis')}
      action={
        JSON.stringify(setting.value) !== JSON.stringify(setting.default) && (
          <ResetAction onReset={() => save({ key: setting.key, value: setting.default })} />
        )
      }
    >
      <p className="px-1 text-sm font-light text-text-muted">{t('settingsKpisHelp')}</p>
      <div className="grid gap-3">
        {card('higher')}
        {card('lower')}
      </div>
    </RecordSection>
  );
}
function ResetAction({ onReset }: { onReset: () => void }) {
  const t = useTranslations('admin');
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('resetNamed', { name: t('settingsKpis') })}
      className="text-text-muted hover:text-text"
      onClick={onReset}
    >
      <RotateCcw className="size-3.5" aria-hidden />
      {t('reset')}
    </Button>
  );
}
// Two decimals at most, so 0.995 reads as 99.5 and not 99.49999999999999.
function round(value: number) {
  return Math.round(value * 100) / 100;
}
// The three statuses in order, each read as the same four columns: its chip, a leading word, the
// boundary, and the rest of the span. The two boundaries are the fields; the third row prints the
// edge of the next band in the same column, so the values line up down the card.
function useRules(direction: Direction, on: number, near: number, field: Field): Rule[] {
  const t = useTranslations('admin');
  const labels = useKpiLabels();
  const share = (ratio: number) => labels.value(round(ratio * 100), 'percent');
  const parts = {
    lead: (chunks: ReactNode) => <span className="text-text-muted">{chunks}</span>,
    tail: (chunks: ReactNode) => <span>{chunks}</span>,
  };
  const onField = () => field('on', 'on_target');
  const nearField = () => field('near', 'near_target');
  const fixedField = () => <FixedPercent ratio={near} />;
  if (direction === 'higher')
    return [
      { status: 'on_target', rule: t.rich('thresholdHigherOn', { ...parts, field: onField }) },
      {
        status: 'near_target',
        rule: t.rich('thresholdHigherNear', { ...parts, field: nearField, upper: share(on) }),
      },
      {
        status: 'off_target',
        rule: t.rich('thresholdHigherOff', { ...parts, field: fixedField }),
      },
    ];
  return [
    { status: 'on_target', rule: t.rich('thresholdLowerOn', { ...parts, field: onField }) },
    {
      status: 'near_target',
      rule: t.rich('thresholdLowerNear', { ...parts, field: nearField, lower: share(on) }),
    },
    { status: 'off_target', rule: t.rich('thresholdLowerOff', { ...parts, field: fixedField }) },
  ];
}
// The printed edge of the last band, set like a field's value so it sits in the fields' column.
function FixedPercent({ ratio }: { ratio: number }) {
  return (
    <span className="flex items-center gap-2">
      <span dir="ltr" className="flex h-8 w-24 items-center px-2.5 text-start tabular-nums">
        {String(Math.round(ratio * 1000) / 10)}
      </span>
      <span className="text-sm font-light text-text-muted">%</span>
    </span>
  );
}
function DirectionCard({
  direction,
  on,
  near,
  field,
}: {
  direction: Direction;
  on: number;
  near: number;
  field: Field;
}) {
  const t = useTranslations('admin');
  const labels = useKpiLabels();
  const rules = useRules(direction, on, near, field);
  // The rows share one grid of columns (chip, leading word, value, rest), so chips, words and
  // values line up across rows; on a phone the chip takes a line of its own above the rule.
  return (
    <div className="grid content-start gap-3 rounded-xl border bg-bg/50 p-3">
      <h4 className="text-sm font-medium">
        {t(direction === 'higher' ? 'thresholdHigher' : 'thresholdLower')}
      </h4>
      <ul className="grid grid-cols-[minmax(3rem,auto)_auto_minmax(0,1fr)] gap-x-2 gap-y-3 sm:grid-cols-[10rem_minmax(3.5rem,auto)_auto_minmax(0,1fr)] sm:gap-x-3 sm:gap-y-2">
        {rules.map(({ status, rule }) => (
          <li
            key={status}
            className="col-span-full grid grid-cols-subgrid items-center gap-y-1.5 sm:min-h-9"
          >
            <span
              className={`col-span-full inline-flex h-6 w-40 items-center gap-1.5 justify-self-start rounded-full px-2.5 text-xs sm:col-span-1 sm:w-full ${labels.chip(status)}`}
            >
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${labels.dot(status)}`} />
              <span className="truncate">{labels.status(status)}</span>
            </span>
            <span className="contents text-sm font-light">{rule}</span>
          </li>
        ))}
      </ul>
      <Example direction={direction} on={on} near={near} />
    </div>
  );
}
// A worked example for a target of 100, or, while the two boundaries cross, what has to change.
function Example({ direction, on, near }: { direction: Direction; on: number; near: number }) {
  const t = useTranslations('admin');
  const labels = useKpiLabels();
  const reading = (ratio: number) => labels.decimal(round(ratio * EXAMPLE_TARGET));
  const names = {
    onName: labels.status('on_target'),
    nearName: labels.status('near_target'),
    offName: labels.status('off_target'),
  };
  if (direction === 'higher' ? on < near : on > near)
    return (
      <p className="border-t pt-2 text-xs/5 text-status-bad-ink" role="alert">
        {t(direction === 'higher' ? 'thresholdOrderHigher' : 'thresholdOrderLower', names)}
      </p>
    );
  return (
    <p className="border-t pt-2 text-xs/5 font-light text-text-muted" role="status">
      {t(direction === 'higher' ? 'thresholdExampleHigher' : 'thresholdExampleLower', {
        target: labels.decimal(EXAMPLE_TARGET),
        on: reading(on),
        near: reading(near),
        ...names,
      })}
    </p>
  );
}
