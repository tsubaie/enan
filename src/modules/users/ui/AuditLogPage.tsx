'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { AuditChange, AuditType } from '@/core/config/audit-schema';
import { addMonths, firstOfMonth, monthOf } from '@/core/time/calendar';
import { addDays } from '@/core/time/days';
import { ChoiceSelect } from '@/ui/layout/ChoiceSelect';
import { DatePicker } from '@/ui/layout/DatePicker';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { useToday } from '@/ui/format';
import { useAdminResource } from './queries';
import { AuditPages, AuditRow } from './AuditList';

// ADMIN-B72, ADMIN-B73: the audit log, narrowed by kind of entry, by what was done and to a span
// of days. The server does the narrowing, so the newest hundred that match are all there, however
// busy the rest of the log is.
type Shown = 'all' | AuditType;
type Done = 'all' | AuditChange;
const When = z.enum([
  'any',
  'today',
  'yesterday',
  'days7',
  'days30',
  'this_month',
  'last_month',
  'custom',
]);
type When = z.infer<typeof When>;
const shownChoices: Shown[] = ['all', ...AuditType.options];
const doneChoices: Done[] = ['all', ...AuditChange.options];
export type Filter = {
  type: Shown;
  done: Done;
  when: When;
  from: string | null;
  to: string | null;
};
// The days a choice covers, both included, counted from the workspace's today.
function spanOf(filter: Filter, today: string): [string | null, string | null] {
  const month = monthOf(today);
  const spans: Record<When, [string | null, string | null]> = {
    any: [null, null],
    today: [today, today],
    yesterday: [addDays(today, -1), addDays(today, -1)],
    days7: [addDays(today, -6), today],
    days30: [addDays(today, -29), today],
    this_month: [firstOfMonth(month), today],
    last_month: [firstOfMonth(addMonths(month, -1)), addDays(firstOfMonth(month), -1)],
    custom: [filter.from, filter.to],
  };
  return spans[filter.when];
}
// The API path for a filter: `audit` alone when nothing narrows it.
export function pathOf(filter: Filter, today: string) {
  const [from, to] = spanOf(filter, today);
  const params = new URLSearchParams(
    Object.entries({
      type: filter.type === 'all' ? null : filter.type,
      // A sign-in neither adds, edits nor deletes anything.
      change: filter.done === 'all' || filter.type === 'sign_in' ? null : filter.done,
      from,
      to,
    }).filter((entry): entry is [string, string] => entry[1] !== null),
  );
  return params.size ? `audit?${params}` : 'audit';
}
export function AuditLogPage() {
  const today = useToday();
  const [filter, setFilter] = useState<Filter>({
    type: 'all',
    done: 'all',
    when: 'any',
    from: null,
    to: null,
  });
  const path = pathOf(filter, today);
  const query = useAdminResource(path);
  return (
    <div className="space-y-4">
      <Filters
        filter={filter}
        set={(change) => setFilter((current) => ({ ...current, ...change }))}
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorPanel error={query.error} retry={() => void query.refetch()} />
      ) : (
        <Entries
          key={path}
          rows={z.array(AuditRow).parse(query.data.data)}
          all={path === 'audit'}
        />
      )}
    </div>
  );
}
function Filters({ filter, set }: { filter: Filter; set: (change: Partial<Filter>) => void }) {
  const t = useTranslations('admin');
  const option = <V extends string>(value: V, text: string) => ({ value, label: text, text });
  const types = shownChoices.map((value) => option(value, t(`auditType_${value}`)));
  const changes = doneChoices.map((value) => option(value, t(`auditChange_${value}`)));
  const spans = When.options.map((value) => option(value, t(`auditWhen_${value}`)));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-56 max-w-full">
        <ChoiceSelect
          label={t('auditFilter')}
          value={filter.type}
          items={types}
          onChange={(type) => set({ type })}
        />
      </div>
      {filter.type !== 'sign_in' && (
        <div className="w-44 max-w-full">
          <ChoiceSelect
            label={t('auditChangeFilter')}
            value={filter.done}
            items={changes}
            onChange={(done) => set({ done })}
          />
        </div>
      )}
      <div className="w-44 max-w-full">
        <ChoiceSelect
          label={t('auditWhen')}
          value={filter.when}
          items={spans}
          onChange={(when) => set({ when })}
        />
      </div>
      {filter.when === 'custom' && (
        <>
          <DatePicker
            label={t('auditFrom')}
            value={filter.from}
            onChange={(from) => set({ from })}
          />
          <DatePicker label={t('auditTo')} value={filter.to} onChange={(to) => set({ to })} />
        </>
      )}
    </div>
  );
}
function Entries({ rows, all }: { rows: z.infer<typeof AuditRow>[]; all: boolean }) {
  const t = useTranslations('admin');
  if (rows.length) return <AuditPages rows={rows} />;
  return (
    <p className="rounded-xl border bg-bg/50 p-8 text-sm font-light text-text-muted">
      {t(all ? 'noAudit' : 'auditNoneOfType')}
    </p>
  );
}
