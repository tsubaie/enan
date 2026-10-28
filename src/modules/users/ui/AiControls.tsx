'use client';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { z } from 'zod';
import { AiControls as Controls } from '@/core/config/ai-controls-schema';
import { AiCapability } from '@/core/config/ai-capabilities';
import { useAiControls, useSaveAiControls } from './ai-queries';
import { Input } from '@/ui/primitives/input';
import { Segmented } from '@/ui/primitives/segmented';
import { useToastManager } from '@/ui/primitives/toast';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { RecordList, RecordSection } from '@/ui/layout/Record';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
type Data = z.infer<typeof Controls>;
type Capability = z.infer<typeof AiCapability>;
// Each feature by what it does for the reader, never by its internal name.
const featureKey: Record<
  Capability,
  | 'aiFeature_tasks_breakdown'
  | 'aiFeature_notes_refine'
  | 'aiFeature_notes_suggest_tags'
  | 'aiFeature_kpis_narrative'
> = {
  'tasks.breakdown': 'aiFeature_tasks_breakdown',
  'notes.refine': 'aiFeature_notes_refine',
  'notes.suggest_tags': 'aiFeature_notes_suggest_tags',
  'kpis.narrative': 'aiFeature_kpis_narrative',
};
// ADMIN-B45: which AI features are on, each one switch that saves at once, the monthly limit in
// dollars, and what this month has cost, feature by feature, in words and money.
export function AiControls() {
  const query = useAiControls();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} />;
  return (
    <>
      <Features data={query.data.data} />
      <Usage data={query.data.data} />
    </>
  );
}
function Features({ data }: { data: Data }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const save = useSaveAiControls();
  const toasts = useToastManager();
  const write = (patch: Partial<Pick<Data, 'enabledCapabilities' | 'monthlyBudgetMicros'>>) =>
    save.mutate(
      {
        enabledCapabilities: data.enabledCapabilities,
        monthlyBudgetMicros: data.monthlyBudgetMicros,
        ...patch,
      },
      { onSuccess: () => toasts.add({ title: c('saved') }) },
    );
  return (
    <RecordSection title={t('aiFeatures')}>
      <PropertySheet>
        {AiCapability.options.map((capability) => {
          const on = data.enabledCapabilities.includes(capability);
          return (
            <Property key={capability} label={t(featureKey[capability])}>
              <Segmented
                label={t(featureKey[capability])}
                value={on ? 'on' : 'off'}
                segments={[
                  { value: 'on', label: t('aiOn') },
                  { value: 'off', label: t('aiOff') },
                ]}
                onChange={(next) =>
                  write({
                    enabledCapabilities:
                      next === 'on'
                        ? [...data.enabledCapabilities, capability]
                        : data.enabledCapabilities.filter((value) => value !== capability),
                  })
                }
              />
            </Property>
          );
        })}
        <LimitRow
          value={data.monthlyBudgetMicros}
          commit={(monthlyBudgetMicros) => write({ monthlyBudgetMicros })}
        />
      </PropertySheet>
      {save.error && <ErrorPanel error={save.error} />}
    </RecordSection>
  );
}
// ADR 0033: the limit is stored in micro-dollars and typed in dollars, to the cent.
const micros = 1000000;
function LimitRow({
  value,
  commit,
}: {
  value: number | null;
  commit: (next: number | null) => void;
}) {
  const t = useTranslations('admin');
  const shown = value === null ? '' : (value / micros).toString();
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  if (seen !== shown) {
    setSeen(shown);
    setDraft(shown);
  }
  return (
    <Property label={t('aiLimit')}>
      <span className="flex items-center gap-2">
        <Input
          aria-label={t('aiLimit')}
          dir="ltr"
          type="number"
          inputMode="decimal"
          min={0.01}
          step={0.01}
          placeholder={t('aiNoLimit')}
          value={draft}
          className="w-36 text-start tabular-nums"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft === shown) return;
            if (!draft.trim()) return commit(null);
            const next = Math.round(Number(draft) * 100) * (micros / 100);
            if (next !== value && Number.isFinite(next) && next > 0 && next <= 1e15) commit(next);
            else setDraft(shown);
          }}
        />
        <span className="text-sm font-light text-text-muted">{t('aiLimitUnit')}</span>
      </span>
    </Property>
  );
}
function Usage({ data }: { data: Data }) {
  const t = useTranslations('admin');
  const f = useFormatter();
  const dollars = (value: number) =>
    f.number(value / micros, { style: 'currency', currency: 'USD' });
  // The warning counts what active requests may still spend, as admission does.
  const total = data.usedCostMicros + data.reservedCostMicros;
  const near = data.monthlyBudgetMicros !== null && total >= data.monthlyBudgetMicros * 0.8;
  return (
    <RecordSection
      title={t('aiUsageMonth')}
      meta={t('aiUsageTotal', {
        cost: dollars(data.usedCostMicros),
        tokens: f.number(data.usedTokens),
      })}
    >
      {near && (
        <p role="status" className="px-1 text-sm font-light text-danger">
          {t('aiBudgetWarning')}
        </p>
      )}
      {data.usage.length === 0 ? (
        <p className="px-1 text-sm font-light text-text-muted">{t('aiNoUsage')}</p>
      ) : (
        <RecordList>
          {data.usage.map((row) => {
            const known = AiCapability.safeParse(row.capability);
            return (
              <li key={row.capability} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  {known.success ? (
                    t(featureKey[known.data])
                  ) : (
                    <bdi dir="ltr">{row.capability}</bdi>
                  )}
                </span>
                <span className="text-xs font-light text-text-muted tabular-nums">
                  {t('aiUsageLine', {
                    calls: f.number(row.calls),
                    cost: dollars(row.estimatedCostMicros),
                  })}
                </span>
              </li>
            );
          })}
        </RecordList>
      )}
    </RecordSection>
  );
}
