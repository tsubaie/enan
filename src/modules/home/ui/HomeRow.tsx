'use client';
import { Fragment, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { IntentLink } from '@/ui/layout/IntentLink';
import { UserX } from 'lucide-react';
import { Avatar } from '@/ui/layout/Avatar';
import { TaskCheck } from '@/modules/tasks/ui';
import { useKpiLabels } from '@/modules/kpis/ui';
import { KpiStatus } from '@/modules/kpis/schema/validation';
import { Progress } from './HomeBar';
import { usePlainDate, useToday } from '@/ui/format';
import { daysBetween, type Item, type SectionKey } from './home-sections';

// One status fact per row, chosen by the question the section answers: how late, how much is open,
// when it happened.
function useStatus(item: Item, sectionKey: SectionKey) {
  const t = useTranslations('home');
  const date = usePlainDate();
  const today = useToday();
  // HOME-B07: the figure on the row ranks the rows in muted ink; it does not need to shout.
  if (sectionKey === 'overdue' && item.date) {
    const late = daysBetween(item.date, today);
    return late > 0 ? <DaysLate count={late} /> : null;
  }
  if (sectionKey === 'committees' && item.count !== null)
    return t('openWork', { count: item.count });
  if (sectionKey === 'notes' && item.date) return date(item.date);
  return null;
}
// How long something has been late: the line stays muted and only the span of days takes the
// danger ink, so the age reads second to the title it qualifies (HOME-B01).
function DaysLate({ count }: { count: number }) {
  const t = useTranslations('home');
  return (
    <>
      {t.rich('daysLate', {
        count,
        n: (chunks: ReactNode) => <span className="text-danger">{chunks}</span>,
      })}
    </>
  );
}
// How much of what a row carries is already late (HOME-B09, HOME-B10): the figure in the danger
// ink, or nothing when nothing is late. The bar that once sat beside it had no scale and was dropped.
function LateShare({ item }: { item: Item }) {
  const t = useTranslations('home');
  const late = item.overdue ?? 0;
  if (late <= 0) return null;
  return (
    <bdi className="font-normal tabular-nums text-danger">{t('lateOpen', { count: late })}</bdi>
  );
}
// HOME-B10: a chase-list row's second line — how much the person holds, how much of it is late,
// and how long the oldest has been late (or, when nothing is late yet, when the first falls due).
function WaitingFacts({ item }: { item: Item }) {
  const t = useTranslations('home');
  const date = usePlainDate();
  const today = useToday();
  const late = item.date ? daysBetween(item.date, today) : 0;
  const facts: { key: string; node: ReactNode }[] = [];
  if (item.count !== null)
    facts.push({
      key: 'holding',
      node: <bdi className="tabular-nums">{t('holding', { count: item.count })}</bdi>,
    });
  if ((item.overdue ?? 0) > 0) facts.push({ key: 'late', node: <LateShare item={item} /> });
  if (item.date)
    facts.push({
      key: 'date',
      node: (
        <bdi className="tabular-nums">
          {late > 0 ? <DaysLate count={late} /> : t('earliestDue', { date: date(item.date) })}
        </bdi>
      ),
    });
  return (
    <>
      {facts.map((fact, index) => (
        <Fragment key={fact.key}>
          {index > 0 && <span aria-hidden>·</span>}
          {fact.node}
        </Fragment>
      ))}
    </>
  );
}
// A KPI row is a measure: it leads with the reason it is here, the state word in the scorecard's
// own words and ink (KPIS-B07), and says how far through its target it is under the name.
function KpiReason({ item }: { item: Item }) {
  const labels = useKpiLabels();
  const status = KpiStatus.safeParse(item.status);
  if (!status.success) return null;
  return (
    <span
      className={`kpi-status mb-1.5 inline-flex rounded-full px-2 py-0.5 text-xs font-normal ${labels.chip(status.data)}`}
    >
      {labels.status(status.data)}
    </span>
  );
}
function KpiFacts({ item }: { item: Item }) {
  const t = useTranslations('home');
  const k = useTranslations('kpis');
  const labels = useKpiLabels();
  if (!KpiStatus.safeParse(item.status).success) return null;
  return (
    <bdi className="tabular-nums">
      {item.ratio !== null
        ? t('ofTarget', { percent: labels.percent(item.ratio) })
        : k('noReading')}
    </bdi>
  );
}
// HOME-B01: rows that lead with something — the completion check, a face — lead with it in one
// 28 px slot so the titles align. A task the principal can finish here gets a control; a holder
// gets their face (the unassigned row an empty one). The row is not one link: a control inside an
// anchor is neither valid nor operable.
const leading: readonly SectionKey[] = ['overdue', 'today', 'waiting'];
function RowLead({ item, sectionKey }: { item: Item; sectionKey: SectionKey }) {
  if (!leading.includes(sectionKey)) return null;
  return (
    <span className="grid size-7 shrink-0 place-items-center">
      <LeadContent item={item} sectionKey={sectionKey} />
    </span>
  );
}
function LeadContent({ item, sectionKey }: { item: Item; sectionKey: SectionKey }) {
  if (item.revision !== null && (sectionKey === 'overdue' || sectionKey === 'today'))
    return (
      <TaskCheck
        task={{ id: item.id, title: item.title, revision: item.revision, completed: false }}
      />
    );
  if (sectionKey === 'waiting')
    return (
      <span aria-hidden>
        {item.owner ? (
          <Avatar name={item.owner} />
        ) : (
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed text-text-muted">
            <UserX className="size-3" />
          </span>
        )}
      </span>
    );
  return null;
}
// The facts line: what the row belongs to, then the facts its section calls for.
function RowFacts({ item, sectionKey }: { item: Item; sectionKey: SectionKey }) {
  const status = useStatus(item, sectionKey);
  const facts = [
    sectionKey === 'kpis' ? null : item.committee,
    sectionKey === 'committees' ? item.owner : null,
  ].filter(Boolean);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta font-light text-text-muted">
      {/* A fact is user text of any length; `min-w-0` lets it truncate rather than push the tile
          past the screen (HOME-B13). */}
      {facts.map((fact) => (
        <bdi key={fact} className="min-w-0 truncate">
          {fact}
        </bdi>
      ))}
      {status && <bdi className="tabular-nums">{status}</bdi>}
      {sectionKey === 'waiting' && <WaitingFacts item={item} />}
      {sectionKey === 'committees' && (
        <>
          <LateShare item={item} />
          {item.done !== null && <Progress done={item.done} open={item.count ?? 0} />}
        </>
      )}
      {sectionKey === 'kpis' && <KpiFacts item={item} />}
    </span>
  );
}
// Names and titles wrap to two lines rather than truncating to one (HOME-B01); the whole text is
// on the link's title for hover and is the link's accessible name for focus.
export function Row({ item, sectionKey }: { item: Item; sectionKey: SectionKey }) {
  const t = useTranslations('home');
  // HOME-B10: the chase list's one row that is not a person arrives untitled and is named here.
  const title = item.title || (sectionKey === 'waiting' ? t('unassigned') : item.title);
  return (
    <div className="-mx-2 my-0.5 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 hover:bg-[var(--nav-hover)]">
      <RowLead item={item} sectionKey={sectionKey} />
      <IntentLink href={item.href} title={title} className="min-w-0 flex-1">
        {sectionKey === 'kpis' && <KpiReason item={item} />}
        {/* The clamp sits on a block of the page's own direction, so a title aligns to the reading
            start of the interface (the right in Arabic) whatever script it is typed in; the bdi
            keeps its own word order. */}
        <span
          className={`home-title text-nav leading-snug text-text ${sectionKey === 'waiting' ? 'font-medium' : 'font-normal'}`}
        >
          <bdi>{title}</bdi>
        </span>
        <RowFacts item={item} sectionKey={sectionKey} />
      </IntentLink>
    </div>
  );
}
