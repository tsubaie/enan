'use client';
import { useTranslations } from 'next-intl';
import {
  AlarmClock,
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  ListChecks,
  NotebookPen,
  Target,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import { useDateTime, useRelativeTime } from '@/ui/format';
import { useMarkRead } from './queries';
import type { Notification } from '../schema/validation';
// NOTIF-B09: opening marks it read and goes to the subject. The line says what happened in a
// sentence the catalogue owns, so Arabic can order the actor and the record its own way.
// The page passes `showDate` (NOTIF-B16), so a long list says when beside how long ago.
type RowProps = { item: Notification; onOpen: () => void; showDate?: boolean };
export function NotificationRow({ item, onOpen, showDate = false }: RowProps) {
  const relative = useRelativeTime();
  const when = useDateTime();
  const read = useMarkRead();
  const unread = !item.readAt;
  const [Icon, tone] = badge[item.kind];
  return (
    <Button
      variant="ghost"
      className={cn(
        'h-auto w-full items-start justify-start gap-3 rounded-lg px-2.5 py-2.5 text-start font-normal',
        unread
          ? 'bg-accent-soft/75 ring-1 ring-inset ring-accent/20 hover:bg-accent-soft'
          : 'hover:bg-surface-raised/60',
      )}
      onClick={() => {
        if (unread) read.mutate(item.id);
        onOpen();
      }}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
          tone === 'info' ? infoTone(unread) : toneClass[tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        {/* The sentence is the notification; truncating it to one line hides which record it is
            about, which is the only thing the reader opened the centre to find out. */}
        <span
          className={cn(
            'line-clamp-2 text-sm leading-snug whitespace-normal',
            unread ? 'font-medium text-text' : 'font-normal text-text-muted',
          )}
          dir="auto"
        >
          <Sentence item={item} />
        </span>
        <time
          dateTime={item.createdAt}
          title={when(item.createdAt)}
          className="text-xs font-light text-text-muted tabular-nums"
        >
          {relative(item.createdAt)}
          {showDate && ` · ${when(item.createdAt)}`}
        </time>
      </span>
      {unread && <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-accent" />}
    </Button>
  );
}
// The badge says how urgent a kind is before the sentence is read: what is late or broken is
// danger, what needs attention today is warning, the rest is activity.
type Tone = 'danger' | 'warning' | 'success' | 'info';
const toneClass: Record<Exclude<Tone, 'info'>, string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-surface-raised text-success',
};
const infoTone = (unread: boolean) =>
  unread ? 'bg-accent-soft text-accent' : 'bg-surface-raised text-text-muted';
const badge: Record<Notification['kind'], [LucideIcon, Tone]> = {
  'task.overdue': [AlarmClock, 'danger'],
  'update.failed': [CircleAlert, 'danger'],
  'update.rollback_failed': [CircleAlert, 'danger'],
  'update.stalled': [CircleAlert, 'danger'],
  'task.due_today': [Clock, 'warning'],
  'kpi.off_target': [Target, 'warning'],
  'update.blocked': [CircleAlert, 'warning'],
  'update.updater_outdated': [CircleAlert, 'warning'],
  'update.installed': [CircleCheck, 'success'],
  'task.assigned': [ListChecks, 'info'],
  'note.mentioned': [NotebookPen, 'info'],
  'job.finished': [WandSparkles, 'info'],
  'update.available': [Download, 'info'],
};
// Each kind names its own message key, in the map or the switch below, rather than one built from
// the kind at runtime. next-intl
// can check a literal key against the arguments it interpolates and cannot check a computed one,
// and these sentences are exactly the place where a missing argument would show up as a
// half-written line in front of the reader. The keys carry no dots: a kind is `task.assigned`
// because that is what the database stores, but next-intl reads a dot as a path and the catalogue
// is two levels deep by audit (`scripts/audit/i18n.ts`). These kinds name only their subject.
type AboutKind = Exclude<Notification['kind'], 'task.assigned' | 'note.mentioned'>;
const aboutKey: Record<
  AboutKind,
  | 'taskDueToday'
  | 'taskOverdue'
  | 'kpiOffTarget'
  | 'jobFinished'
  | 'updateAvailable'
  | 'updateInstalled'
  | 'updateFailed'
  | 'updateRollbackFailed'
  | 'updateBlocked'
  | 'updateStalled'
  | 'updateUpdaterOutdated'
> = {
  'task.due_today': 'taskDueToday',
  'task.overdue': 'taskOverdue',
  'kpi.off_target': 'kpiOffTarget',
  'job.finished': 'jobFinished',
  // ADMIN-B59: the title is the version the update is about.
  'update.available': 'updateAvailable',
  'update.installed': 'updateInstalled',
  'update.failed': 'updateFailed',
  'update.rollback_failed': 'updateRollbackFailed',
  'update.blocked': 'updateBlocked',
  'update.stalled': 'updateStalled',
  'update.updater_outdated': 'updateUpdaterOutdated',
};
function Sentence({ item }: { item: Notification }) {
  const t = useTranslations('notifications');
  // Only the two kinds someone caused name an actor; the clock, the scorecard and the updater are
  // nobody, and the compiler holds each sentence to the arguments its own message interpolates.
  const by = { actor: item.actorName ?? t('someone'), title: item.title };
  switch (item.kind) {
    case 'task.assigned':
      return t('taskAssigned', by);
    case 'note.mentioned':
      return t('noteMentioned', by);
    default:
      return t(aboutKey[item.kind], { title: item.title });
  }
}
