'use client';
import { CommitteeChip } from '@/modules/committees/ui';
import { useTranslations } from 'next-intl';
import { PersonAvatar } from '@/ui/layout/PersonAvatar';
import { CardBody, CardProgress, CardTitle, Chip } from '@/ui/entity/Card';
import type { Note, Participant } from '../schema/validation';
import { useNoteTypes } from './queries';
import { useNoteDateLabel, useTypeLabel } from './use-note-labels';
// NOTES-B02: compact cards prioritize the title; tags and participants remain in details.
// The title is the shared card title (docs/design-system.md § Cards), so a note's card and a task's
// carry their names in one size and weight.
export function NoteRow({ note }: { note: Note }) {
  return (
    <CardBody>
      <CardTitle>{note.title}</CardTitle>
    </CardBody>
  );
}
// `inCommittee` is set where the list already sits inside a committee, so the card does not repeat
// that committee's name.
export function NoteTrail({ note, inCommittee = false }: { note: Note; inCommittee?: boolean }) {
  const t = useTranslations('notes');
  const types = useNoteTypes();
  const typeLabel = useTypeLabel(types.data?.data);
  const date = useNoteDateLabel()(note);
  const tasks = note.openTaskCount + note.doneTaskCount;
  return (
    <span className="flex flex-wrap items-center justify-end gap-2 text-xs text-text-muted @lg:gap-3">
      {note.committee && !inCommittee && (
        <span data-card-more className="contents">
          <CommitteeChip committee={note.committee} />
        </span>
      )}
      {note.type && <Chip>{typeLabel(note.type)}</Chip>}
      <span data-card-more className="contents">
        {note.archivedAt && <Chip tone="warning">{t('archivedChip')}</Chip>}
        <CardProgress
          done={note.doneTaskCount}
          total={tasks}
          label={t('taskCounts', { open: note.openTaskCount, done: note.doneTaskCount })}
        />
      </span>
      <time
        dateTime={note.noteDate}
        title={date.absolute}
        className="whitespace-nowrap tabular-nums"
      >
        {date.label}
      </time>
    </span>
  );
}
// Beside the row (EP-B20): up to three initials avatars that reveal the full name when pressed,
// exactly as the owner avatar on a task row, then a "+n" count.
export function ParticipantsTrail({ participants }: { participants: Participant[] }) {
  const t = useTranslations('notes');
  if (!participants.length) return null;
  const shown = participants.slice(0, 3);
  return (
    <span className="flex items-center -space-x-1 rtl:space-x-reverse">
      {shown.map((person) => (
        <PersonAvatar key={person.id} name={person.name} className="ring-2 ring-surface" />
      ))}
      {participants.length > shown.length && (
        <span className="ps-2 text-[10px] text-text-muted">
          {t('more', { count: participants.length - shown.length })}
        </span>
      )}
    </span>
  );
}
