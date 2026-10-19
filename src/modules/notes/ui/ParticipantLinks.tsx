'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/ui/layout/Avatar';
import { routes } from '@/core/routes';
import { Property } from '@/ui/layout/Property';
import type { Participant } from '../schema/validation';
// Read-only: each participant links to their page, like the owner link on a task.
export function ParticipantLinks({ participants }: { participants: Participant[] }) {
  const t = useTranslations('notes');
  if (!participants.length) return null;
  return (
    <Property label={t('participants')}>
      <div className="flex flex-wrap items-center gap-1.5 py-1.5">
        {participants.map((person) => (
          <Link
            key={person.id}
            href={routes.person(person.id)}
            className="inline-flex items-center gap-1 rounded-full bg-surface-raised py-0.5 ps-0.5 pe-2 text-xs text-accent hover:bg-accent-soft"
          >
            <Avatar name={person.name} className="size-5 text-[9px]" />
            <bdi>{person.name}</bdi>
          </Link>
        ))}
      </div>
    </Property>
  );
}
