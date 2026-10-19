'use client';
import { useTranslations } from 'next-intl';
import { CalendarDays, ListChecks, NotebookPen, Users } from 'lucide-react';
import { cn } from '@/ui/cn';
import type { Task } from '../schema/validation';
import { PersonAvatar } from '@/ui/layout/PersonAvatar';
import { useDueLabel } from './use-due-label';
import {
  CardBody,
  CardExcerpt,
  CardFact,
  CardFacts,
  CardTitle,
  cardFact,
  cardFactIcon,
} from '@/ui/entity/Card';
// TASKS UI (ADR 0030): the card view is for reading and deciding, the table for scanning columns.
// A card reads top to bottom like a note: the title, a line of the description, then the facts that
// decide what to do with it, each behind its own icon. The card is one button, so none of it is a
// link of its own; the owner's face is the one control and sits at the card's end.
// `inCommittee` is set where the list already sits inside a committee, so the card does not repeat
// that committee's name.
export function TaskRow({ task, inCommittee = false }: { task: Task; inCommittee?: boolean }) {
  const excerpt = task.description?.replace(/\s+/gu, ' ').trim();
  return (
    <CardBody>
      <CardTitle
        done={task.status === 'completed'}
        after={<TaskPriority priority={task.priority} />}
      >
        {task.title}
      </CardTitle>
      {excerpt && <CardExcerpt>{excerpt}</CardExcerpt>}
      <TaskFacts task={task} inCommittee={inCommittee} />
    </CardBody>
  );
}
function useCommitteeLabel(committee: Task['committee']) {
  const committees = useTranslations('committees');
  if (!committee) return null;
  if (!committee.deleted && committee.status !== 'archived') return committee.name;
  return `${committee.name} (${committees(committee.deleted ? 'trash' : 'archived')})`;
}
function TaskFacts({ task, inCommittee }: { task: Task; inCommittee: boolean }) {
  const t = useTranslations('tasks');
  const label = useCommitteeLabel(task.committee);
  const committee = inCommittee ? null : label;
  const note = task.sourceNote;
  const status = task.status !== 'next_action' && task.status !== 'completed';
  const facts = Boolean(task.dueDate) || status || Boolean(committee) || Boolean(note);
  if (!facts && task.subtaskCount === 0) return null;
  return (
    <CardFacts>
      <TaskDue task={task} />
      {status && <span className={cardFact}>{t(task.status)}</span>}
      {committee && (
        <CardFact icon={Users} title={committee} className="text-accent">
          {committee}
        </CardFact>
      )}
      {note && (
        <CardFact icon={NotebookPen} title={note.title}>
          {note.deletedAt ? t('noteTrashed') : note.title}
        </CardFact>
      )}
      <TaskProgress task={task} />
    </CardFacts>
  );
}
// TASKS-B03: when it falls due, in the same words the record uses, red when late.
function TaskDue({ task }: { task: Task }) {
  const due = useDueLabel()(task);
  if (!due || !task.dueDate) return null;
  return (
    <time
      dateTime={task.dueDate}
      title={due.absolute}
      className={cn(
        cardFact,
        'tabular-nums',
        due.tone === 'danger' && 'font-medium text-danger',
        due.tone === 'accent' && 'font-medium text-accent',
      )}
    >
      <CalendarDays className={cardFactIcon} aria-hidden />
      {due.label}
    </time>
  );
}
function TaskProgress({ task }: { task: Task }) {
  const t = useTranslations('tasks');
  if (task.subtaskCount === 0) return null;
  const counts = { done: task.completedSubtaskCount, total: task.subtaskCount };
  return (
    <span className={cn(cardFact, 'tabular-nums')} title={t('progress', counts)}>
      <ListChecks className={cardFactIcon} aria-hidden />
      {t('progressShort', counts)}
    </span>
  );
}
// The owner's face is the card's one control, at its end edge.
export function TaskTrail({ task }: { task: Task }) {
  if (!task.ownerName) return null;
  return (
    <span className="flex justify-end">
      <PersonAvatar name={task.ownerName} />
    </span>
  );
}

// Only urgent and high are marked, with a dot and the word in the danger or warning ink, so the eye
// lands on what needs it; medium and low live in the record and leave the card quiet.
function TaskPriority({ priority }: { priority: Task['priority'] }) {
  const t = useTranslations('tasks');
  if (priority !== 'urgent' && priority !== 'high') return null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs leading-none font-normal',
        priority === 'urgent' ? 'text-danger' : 'text-warning',
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {t(priority)}
    </span>
  );
}
