'use client';
import type { ReactNode } from 'react';
import { RecordSection, RecordTitle } from '@/ui/layout/Record';
import { RecordTitleField } from '@/ui/layout/RecordTitleField';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { EntityFooter, EntityUpdated } from '@/ui/entity/EntityFooter';
import type { DetailApi } from '@/ui/entity/types';
import { KpiHeadline, KpiSummary, LatestNote } from './KpiHeadline';
import { KpiTrend } from './KpiTrend';
import { KpiNarrative } from './KpiNarrative';
import { KpiMaintenance } from './KpiMaintain';
import { KpiDefinition, KpiOwnership } from './KpiFields';
import { useKpi } from './queries';
import type { Kpi, KpiPatch } from '../schema/validation';
// KPIS-B08, EP-B25: a KPI is read far more often than it is edited, so the panel reads as a record
// and becomes a form on contact — the same shape every other entity uses.
//
// The order is what a principal asks for, in the order they ask it: the answer in a sentence, then
// the arc that confirms it, then the owner's own words on why it moved, then who holds it, then the
// trend — the one piece of evidence that is read every time.
//
// Everything a KPI is *maintained* from leaves the reading. The reading history and the year's
// targets become two tasks the record offers, each opening into a dialog with the width its table
// needs (KpiMaintain). The definition — set once by the owner and read by nobody afterwards — stays
// here but folds away at the end. Each control says on its face how much sits behind it, so nothing
// has to be opened to find out whether it is empty.
export function KpiRecord({ kpi, api }: { kpi: Kpi; api: DetailApi<Omit<KpiPatch, 'revision'>> }) {
  const t = useTranslations('kpis');
  const c = useTranslations('common');
  const record = useKpi(kpi.id, Boolean(kpi.deletedAt));
  const data = record.data;
  const editable = !kpi.deletedAt;
  const save = editable ? api.save : undefined;
  return (
    <div className="@container min-w-0">
      {kpi.deletedAt ? (
        <RecordTitle>{kpi.name}</RecordTitle>
      ) : (
        <RecordTitleField
          kind="name"
          value={kpi.name}
          label={t('name')}
          save={(name) => api.save({ name })}
        />
      )}
      {kpi.deletedAt && (
        <Button className="mt-4" onClick={api.restore}>
          {c('restore')}
        </Button>
      )}
      {record.error && <ErrorPanel error={record.error} />}
      {!data ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {c('loading')}
        </p>
      ) : (
        <>
          <div className="mt-1 grid gap-6">
            <KpiSummary kpi={data} />
            <KpiHeadline kpi={data} />
            <LatestNote kpi={data} />
            {editable && <KpiNarrative kpiId={kpi.id} />}
            <KpiOwnership initial={data} save={save} />
          </div>
          <RecordSection title={t('trend')}>
            <KpiTrend kpi={data} />
          </RecordSection>
          <KpiMaintenance kpi={data} editable={editable} />
          <Fold title={t('definition')}>
            <KpiDefinition initial={data} save={save} />
          </Fold>
          <KpiFooter updatedAt={data.updatedAt} remove={editable ? api.remove : null} />
        </>
      )}
    </div>
  );
}
// Native disclosure: keyboard-operable, reachable by find-in-page once open, and no state of its
// own. The chevron turns with it and mirrors in RTL like every other pointer.
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="kpi-fold mt-8">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-sm font-medium">
        <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden={true} />
        {title}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
function KpiFooter({ updatedAt, remove }: { updatedAt: string; remove: (() => void) | null }) {
  return (
    <EntityFooter remove={remove}>
      <EntityUpdated at={updatedAt} />
    </EntityFooter>
  );
}
