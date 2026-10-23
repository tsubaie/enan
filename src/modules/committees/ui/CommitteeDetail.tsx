'use client';
import { useTranslations } from 'next-intl';
import { Tabs } from '@base-ui/react/tabs';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { ShowMore } from '@/ui/layout/ShowMore';
import { useDateTime } from '@/ui/format';
import type { DetailApi } from '@/ui/entity/types';
import { EntityFooter, EntityUpdated } from '@/ui/entity/EntityFooter';
import { CommitteeTasks } from '@/modules/tasks/ui';
import { CommitteeNotes } from '@/modules/notes/ui';
import type { Committee, CommitteePatch } from '../schema/validation';
import { CommitteeFields } from './CommitteeFields';
import { RecordTitle } from '@/ui/layout/Record';
import { RecordTitleField } from '@/ui/layout/RecordTitleField';
import { cn } from '@/ui/cn';
import { segmentedItem, segmentedTrack } from '@/ui/primitives/segmented';
import { useCommitteeActivity } from './queries';
const tabs: Array<'tasks' | 'notes' | 'activity'> = ['tasks', 'notes', 'activity'];
export function CommitteeDetail({
  committee,
  api,
}: {
  committee: Committee;
  api: DetailApi<Omit<CommitteePatch, 'revision'>>;
}) {
  const t = useTranslations('committees');
  const c = useTranslations('common');
  return (
    <div className="grid gap-6">
      <CommitteeName committee={committee} api={api} />
      {committee.deletedAt ? (
        <Button onClick={api.restore}>{c('restore')}</Button>
      ) : (
        <CommitteeFields initial={committee} save={api.save} />
      )}
      <Tabs.Root defaultValue="tasks">
        {/* The linked work is chosen with a capsule segmented control, the shape every view switch in
          the product takes (docs/design-system.md § Controls). */}
        <Tabs.List aria-label={t('linkedWork')} className={cn(segmentedTrack, 'mb-4')}>
          {tabs.map((tab) => (
            <Tabs.Tab
              key={tab}
              value={tab}
              className={cn(
                segmentedItem,
                'transition-colors data-active:bg-surface data-active:font-medium data-active:text-text data-active:shadow-sm',
              )}
            >
              {t(tab)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="tasks">
          <CommitteeTasks
            committeeId={committee.id}
            allowCreate={!committee.deletedAt && committee.status === 'active'}
          />
        </Tabs.Panel>
        <Tabs.Panel value="notes">
          <CommitteeNotes
            committeeId={committee.id}
            allowCreate={!committee.deletedAt && committee.status === 'active'}
          />
        </Tabs.Panel>
        <Tabs.Panel value="activity">
          <CommitteeActivity id={committee.id} />
        </Tabs.Panel>
      </Tabs.Root>
      <EntityFooter remove={committee.deletedAt ? null : api.remove}>
        <EntityUpdated at={committee.updatedAt} />
      </EntityFooter>
    </div>
  );
}
// The name is the record's heading and is edited in place; a committee in the trash only shows it.
function CommitteeName({
  committee,
  api,
}: {
  committee: Committee;
  api: DetailApi<Omit<CommitteePatch, 'revision'>>;
}) {
  const t = useTranslations('committees');
  if (committee.deletedAt) return <RecordTitle>{committee.name}</RecordTitle>;
  return (
    <RecordTitleField
      kind="name"
      value={committee.name}
      label={t('name')}
      save={(name) => api.save({ name })}
    />
  );
}
function CommitteeActivity({ id }: { id: string }) {
  const t = useTranslations('committees');
  const c = useTranslations('common');
  const dateTime = useDateTime();
  const query = useCommitteeActivity(id);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <div className="grid gap-3">
      {query.error && <ErrorPanel error={query.error} />}
      {query.isPending && <p role="status">{c('loading')}</p>}
      {!query.isPending && !rows.length && (
        <p className="text-sm text-text-muted">{t('noActivity')}</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border bg-bg/50">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-0.5 px-3 py-2.5 text-sm">
              <p>
                {t('activityEntry', {
                  entity: t(
                    row.entityType === 'task'
                      ? 'taskEntity'
                      : row.entityType === 'note'
                        ? 'noteEntity'
                        : 'committee',
                  ),
                  action: t(activityAction(row.action)),
                })}
              </p>
              <time className="text-xs font-light text-text-muted" dateTime={row.createdAt}>
                {dateTime(row.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
      <ShowMore shown={rows.length} more={query.hasNextPage} onMore={query.fetchNextPage} />
    </div>
  );
}

function activityAction(action: string) {
  switch (action) {
    case 'create':
      return 'actionCreate';
    case 'archive':
      return 'actionArchive';
    case 'unarchive':
      return 'actionUnarchive';
    case 'delete':
      return 'actionDelete';
    case 'restore':
      return 'actionRestore';
    case 'reorder':
      return 'actionReorder';
    default:
      return 'actionUpdate';
  }
}
