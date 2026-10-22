'use client';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, CalendarClock, ListChecks, ListTodo } from 'lucide-react';
import { cn } from '@/ui/cn';
import { useCount } from '@/ui/format';
// The pieces every list card is built from (docs/design-system.md § Cards), so a task, a note and a
// person read as one family and a change here reaches all of them. A card reads top to bottom: the
// title in Regular, at most one Extra Light line under it, then the facts that decide what to do with the
// item, each behind its own icon. Chips and the faces of the people involved sit in the card's
// trail at its end edge. The card is one button, so nothing in its body is a control of its own.
export function CardBody({ children }: { children: ReactNode }) {
  return <span className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</span>;
}
// `after` sits beside the title on its line (a task's priority); `done` strikes it through.
export function CardTitle({
  children,
  after,
  done = false,
}: {
  children: ReactNode;
  after?: ReactNode;
  done?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        dir="auto"
        data-card-title
        className={cn(
          'plaintext line-clamp-2 min-w-0 text-nav leading-snug font-normal whitespace-normal',
          done && 'text-text-muted line-through',
        )}
      >
        {children}
      </span>
      {after}
    </span>
  );
}
export function CardExcerpt({ children }: { children: ReactNode }) {
  return (
    <span
      dir="auto"
      data-card-excerpt
      className="plaintext line-clamp-1 max-w-full min-w-0 self-start text-sm font-extralight whitespace-normal text-text-muted"
    >
      {children}
    </span>
  );
}
export function CardFacts({ children }: { children: ReactNode }) {
  return (
    <span
      data-card-facts
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs font-light text-text-muted empty:hidden"
    >
      {children}
    </span>
  );
}
export const cardFact = 'inline-flex min-w-0 items-center gap-1.5';
export const cardFactIcon = 'size-3.5 shrink-0';
// One fact: an icon and a short value that truncates, with the whole value on hover.
export function CardFact({
  icon: Icon,
  children,
  title,
  className,
}: {
  icon?: (props: { className?: string; 'aria-hidden'?: boolean }) => ReactNode;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span className={cn(cardFact, className)} title={title}>
      {Icon && <Icon className={cardFactIcon} aria-hidden />}
      <bdi className="truncate">{children}</bdi>
    </span>
  );
}
// A short label in the trail: a type, a state, a tag. Neutral unless it warns.
export function Chip({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'warning' | 'tag';
}) {
  return (
    <span
      className={cn(
        'max-w-32 shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] leading-tight font-normal',
        tone === 'muted' && 'bg-surface-raised/60 text-text-muted',
        tone === 'warning' && 'bg-warning-soft text-warning uppercase',
        tone === 'tag' && 'bg-surface-raised text-text-muted',
      )}
    >
      {children}
    </span>
  );
}
// What someone is carrying, in the same words on every card that has tasks (a person, a committee):
// the open tasks ("No open tasks" when none), the late ones in the danger ink, and the ones due
// today in the accent. Each is a word as well as a colour.
export function CardWorkload({
  open,
  late,
  today,
}: {
  open: number;
  late: number;
  today?: number;
}) {
  const t = useTranslations('common');
  return (
    <>
      <CardFact icon={ListTodo} className="tabular-nums">
        {t('openTasksCount', { count: open })}
      </CardFact>
      {late > 0 && (
        <CardFact icon={AlarmClock} className="font-medium text-danger tabular-nums">
          {t('lateTasksCount', { count: late })}
        </CardFact>
      )}
      {today !== undefined && today > 0 && (
        <CardFact icon={CalendarClock} className="font-medium text-accent tabular-nums">
          {t('dueTodayCount', { count: today })}
        </CardFact>
      )}
    </>
  );
}
// How much of the work is done, for the trail: a short bar and "done/total", green once all of it
// is. `label` says it in words for the hover and for assistive technology.
export function CardProgress({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const count = useCount();
  if (total === 0) return null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-raised/60 px-2 py-1 text-xs text-text-muted tabular-nums',
        done === total && 'text-success',
      )}
      title={label}
    >
      <ListChecks className="size-3.5" aria-hidden />
      <progress
        className={cn('h-1 w-8', done === total ? 'text-success' : 'text-accent')}
        value={done}
        max={total}
        aria-label={label}
      />
      {count(done)}/{count(total)}
    </span>
  );
}
