'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlarmClock } from 'lucide-react';
import { useTasks } from './queries';
import { useDueLabel } from './use-due-label';
import type { Task } from '../schema/validation';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { routes } from '@/core/routes';
import { RecordList, RecordMore, RecordSection } from '@/ui/layout/Record';
export function OwnerTasks({ personId }: { personId: string }) {
  const t = useTranslations('tasks');
  const query = useTasks({ view: 'all', q: '', sort: '', ownerId: personId });
  return (
    <RecordSection title={t('assignedTasks')}>
      {query.error && <ErrorPanel error={query.error} />}
      <RecordList>
        {query.items.slice(0, 5).map((task) => (
          <li key={task.id}>
            <Link
              href={routes.tasks({ view: 'all', ownerId: personId, id: task.id })}
              className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-surface-raised/50"
            >
              <bdi className="min-w-0 flex-1 truncate">{task.title}</bdi>
              <LateMark task={task} />
            </Link>
          </li>
        ))}
      </RecordList>
      <RecordMore href={routes.tasks({ view: 'all', ownerId: personId })}>
        {t('viewAssigned', { count: query.counts.all ?? 0 })}
      </RecordMore>
    </RecordSection>
  );
}
// A task past its due date says so at the row's end: a red capsule with a clock, the word "Overdue"
// and how long ago it fell due, the exact date on hover. The word carries the meaning, so the
// colour is never the only signal.
function LateMark({ task }: { task: Task }) {
  const t = useTranslations('tasks');
  const due = useDueLabel()(task);
  if (task.band !== 'overdue' || task.status === 'completed' || !due) return null;
  return (
    <span
      title={due.absolute}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger"
    >
      <AlarmClock className="size-3.5" aria-hidden />
      {t('overdue')}
      <span className="font-light tabular-nums">· {due.label}</span>
    </span>
  );
}
