'use client';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Landmark, Archive, Trash2, CalendarDays, AlertCircle, ListChecks, CheckCircle2, NotebookPen } from 'lucide-react';
import { EntityPage } from '@/ui/entity/EntityPage';
import { sortOptions } from '@/ui/entity/filters';
import { usePlainDate } from '@/ui/format';
import { CardBody, CardExcerpt, CardFact, CardFacts, CardProgress, CardTitle, CardWorkload, Chip } from '@/ui/entity/Card';
import { Scope, Sort, type Committee } from '../schema/validation';
import { useCommittees, useCommittee, useCommitteeMutations } from './queries';
import { CreateCommittee } from './CreateCommittee';
import { useCommitteeColumns } from './CommitteeColumns';
import { usePrefetch } from '@/ui/entity/use-prefetch';
const importRecord = () => import('./CommitteeDetail');
const CommitteeDetail = dynamic(() => importRecord().then((module) => module.CommitteeDetail));
export function CommitteesPage() {
  const t = useTranslations('committees');
  const mutations = useCommitteeMutations();
  const columns = useCommitteeColumns();
  usePrefetch(importRecord);
  return <EntityPage module="committees" title={t('title')} searchLabel={t('searchList')} description={t('intro')}
    filters={{ views: [
      { id: 'active', label: t('active'), icon: Landmark }, { id: 'all', label: t('all'), icon: Landmark },
      { id: 'overdue', label: t('overdue'), icon: AlertCircle, featured: true, tone: 'danger' },
      { id: 'today', label: t('today'), icon: CalendarDays, featured: true, tone: 'accent' },
      { id: 'open', label: t('open'), icon: ListChecks, featured: true },
      { id: 'completed', label: t('completed'), icon: CheckCircle2, featured: true },
      { id: 'archived', label: t('archived'), icon: Archive, separated: true }, { id: 'trash', label: t('trash'), icon: Trash2 },
    ], sort: sortOptions(Sort.options, t), facets: [{ key: 'scope', label: t('scope'), options: [{ value: '', label: t('all') }, ...Scope.options.map((scope) => ({ value: scope, label: t(scope) }))] }] }}
    useList={useCommittees} useDetail={useCommittee} mutations={mutations} group={(item) => item.deletedAt ? null : t(item.scope)}
    renderers={{ rowStyle: 'card', columns, name: (item) => item.name, deletedMessage: t('deletedToast'), row: (item) => <CommitteeRow committee={item} />,
      rowTrail: (item) => <CommitteeStats committee={item} />, detail: (item, api) => <CommitteeDetail committee={item} api={api} />,
      create: (api) => <CreateCommittee api={api} /> }} />;
}
// COMM-B02: the card answers what a committee member opens the list for: who the committee belongs
// to, how much work is open, what is late or due today, and when it last met on paper. It is built
// from the shared card pieces (docs/design-system.md § Cards). There is no status dot and no scope
// chip: the view says which committees are active and the group heading says internal or external.
function CommitteeRow({ committee }: { committee: Committee }) {
  return <CardBody>
    <CardTitle>{committee.name}</CardTitle>
    {committee.ownership && <CardExcerpt>{committee.ownership}</CardExcerpt>}
    <CardFacts>
      <CardWorkload open={committee.stats.open} late={committee.stats.overdue} today={committee.stats.today} />
    </CardFacts>
  </CardBody>;
}
// The trail fills the card's end: how much of the work is done (and "Archived") level with the
// name, and when the committee last met on paper at the bottom, level with the facts line.
function CommitteeStats({ committee }: { committee: Committee }) {
  const t = useTranslations('committees');
  const date = usePlainDate();
  const total = committee.stats.open + committee.stats.completed;
  return <span className="flex flex-1 flex-col items-end gap-2">
    <span className="flex items-center gap-2">
      {committee.status === 'archived' && <Chip tone="warning">{t('archived')}</Chip>}
      <CardProgress done={committee.stats.completed} total={total}
        label={t('taskProgress', { done: committee.stats.completed, total })} />
    </span>
    {committee.lastNoteDate && <span className="mt-auto text-xs text-text-muted">
      <CardFact icon={NotebookPen} className="tabular-nums">{t('lastNote', { date: date(committee.lastNoteDate) })}</CardFact>
    </span>}
  </span>;
}
