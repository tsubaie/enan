'use client';
import { useTranslations } from 'next-intl';
import { NotebookPen } from 'lucide-react';
import type { Person } from '../schema/validation';
import { initials } from '@/ui/format';
import {
  CardBody,
  CardExcerpt,
  CardFact,
  CardFacts,
  CardTitle,
  CardWorkload,
  Chip,
} from '@/ui/entity/Card';
// PEOPLE-B02: a person's card is built from the shared card pieces (docs/design-system.md § Cards)
// and answers what the directory is opened for: what this person is carrying. Under the name and
// role sit the open tasks they own, how many of those are late (in the danger ink), and the notes
// they took part in. Contact details and the assignment flag live in the record and the table.
export function PersonRow({ person }: { person: Person }) {
  const p = useTranslations('people');
  const stats = person.stats;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-medium text-text"
      >
        <bdi>{initials(person.fullName)}</bdi>
      </span>
      <CardBody>
        <CardTitle>{person.fullName}</CardTitle>
        {person.roleTitle && <CardExcerpt>{person.roleTitle}</CardExcerpt>}
        {stats && (
          <CardFacts>
            <CardWorkload open={stats.openTasks} late={stats.lateTasks} />
            {stats.notes > 0 && (
              <span data-card-more className="contents">
                <CardFact icon={NotebookPen} className="tabular-nums">
                  {p('cardNotes', { count: stats.notes })}
                </CardFact>
              </span>
            )}
          </CardFacts>
        )}
      </CardBody>
    </span>
  );
}
// The trail: up to two tags, then whether the person is inside the organisation or outside it.
export function PersonTrail({ person }: { person: Person }) {
  const t = useTranslations('common');
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <span data-card-more className="contents">
        {person.tags.slice(0, 2).map((tag) => (
          <Chip key={tag} tone="tag">
            <bdi>{tag}</bdi>
          </Chip>
        ))}
      </span>
      <Chip>{t(person.kind)}</Chip>
    </span>
  );
}
