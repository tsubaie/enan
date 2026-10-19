'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { routes } from '@/core/routes';
import { RecordList, RecordMore, RecordSection } from '@/ui/layout/Record';
import { useNotes } from './queries';
// NOTES-B15: the latest five notes a person took part in, and a link to the filtered list.
export function PersonNotes({ personId }: { personId: string }) {
  const t = useTranslations('notes');
  const list = useNotes({ view: 'all', q: '', sort: '', personId });
  return (
    <RecordSection title={t('personNotes')}>
      {list.error && <ErrorPanel error={list.error} />}
      <RecordList>
        {list.items.slice(0, 5).map((note) => (
          <li key={note.id}>
            <Link
              href={routes.notes({ view: 'all', personId, id: note.id })}
              className="block truncate px-3 py-2.5 text-sm hover:bg-surface-raised/50"
            >
              <bdi>{note.title}</bdi>
            </Link>
          </li>
        ))}
      </RecordList>
      <RecordMore href={routes.notes({ view: 'all', personId })}>
        {t('viewNotes', { count: list.counts.all ?? 0 })}
      </RecordMore>
    </RecordSection>
  );
}
