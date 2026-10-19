'use client';
import { useTranslations } from 'next-intl';
import { IntentLink } from '@/ui/layout/IntentLink';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/ui/cn';
import { useDayOfMonth, useWeekday } from '@/ui/format';
import { Tile } from './HomeTile';
import type { Day, Section } from './home-sections';

// HOME-B14: the week ahead. Today and the six days after it run as seven even columns, each its
// weekday over its date and, in words, how much top-level open work falls due on it; today is a
// calm filled pill. What is already late is not a day and is not drawn as one: it is a small
// danger capsule in the tile's head that opens the overdue view. When nothing falls due all week
// the strip has nothing to show, so the tile collapses to its head: one quiet line.
//
// Earlier drafts, for the record: day numbers set like headlines read as a scorecard; one mark per
// task said the count twice; an overdue column inside the row read as one more day.
export function Week({
  today,
  overdue,
  className,
}: {
  today: Section;
  overdue: Section | undefined;
  className?: string;
}) {
  const t = useTranslations('home');
  const days = today.days ?? [];
  const due = days.reduce((sum, day) => sum + day.count, 0);
  return (
    <Tile className={cn('home-lead', className)}>
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-start text-heading leading-7 font-normal">
          <span className="truncate">{t('week')}</span>
          <span
            key={due}
            className="count-tick shrink-0 text-sm font-light tabular-nums text-text-muted"
          >
            {t('weekDue', { count: due })}
          </span>
        </h2>
        <div className="flex items-center gap-4">
          {overdue && overdue.count > 0 && <OverdueCapsule section={overdue} />}
          {/* The one link on the page with a chevron: it changes what the reader is looking at. */}
          {today.href && (
            <IntentLink
              className="home-hit inline-flex shrink-0 items-center gap-1 text-xs font-light text-accent hover:underline"
              href={today.href}
            >
              {t('openWeek')}
              <ChevronRight className="size-3 rtl:-scale-x-100" aria-hidden />
            </IntentLink>
          )}
        </div>
      </div>
      {due > 0 && (
        <ul className="mt-4 grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((day, index) => (
            <DayCell key={day.date} day={day} today={index === 0} />
          ))}
        </ul>
      )}
    </Tile>
  );
}
// What is late, kept out of the row of days: a capsule in the danger tone with its count, opening
// the overdue view. It is the one place in the strip that borrows the danger token (HOME-B07).
function OverdueCapsule({ section }: { section: Section }) {
  const t = useTranslations('home');
  const body = (
    <span key={section.count} className="count-tick">
      {t('weekOverdue', { count: section.count })}
    </span>
  );
  const capsule =
    'home-hit inline-flex shrink-0 items-center rounded-full bg-danger-soft px-2.5 py-0.5 text-xs tabular-nums text-danger';
  return section.href ? (
    <IntentLink href={section.href} className={cn(capsule, 'hover:underline')}>
      {body}
    </IntentLink>
  ) : (
    <span className={capsule}>{body}</span>
  );
}
// A day: the weekday over its date, and the count in words — in the text colour when there is
// something and muted when there is not, so the eye lands on the days that carry work. Today is a
// pill in the accent's soft wash. The whole column, at least 44 px tall, opens the task list
// narrowed to that day (HOME-B03, TASKS-B05).
function DayCell({ day, today }: { day: Day; today: boolean }) {
  const t = useTranslations('home');
  const weekday = useWeekday();
  const dayOfMonth = useDayOfMonth();
  return (
    <li aria-current={today ? 'date' : undefined} className="min-w-0">
      <IntentLink
        href={day.href}
        className={cn(
          'flex h-full min-h-11 min-w-0 flex-col items-center gap-0.5 rounded-2xl px-1 py-2.5 text-center transition-colors duration-150',
          today ? 'bg-accent-soft' : 'hover:bg-[var(--nav-hover)]',
        )}
      >
        <span
          className={cn('max-w-full truncate text-xs', today ? 'text-text' : 'text-text-muted')}
        >
          {weekday(day.date)}
        </span>
        <span
          className={cn(
            'text-nav leading-7 tabular-nums',
            today ? 'font-medium text-accent' : 'font-light text-text',
          )}
        >
          {dayOfMonth(day.date)}
        </span>
        <span
          key={day.count}
          className={cn(
            'count-tick max-w-full truncate text-xs tabular-nums',
            day.count > 0 ? 'font-normal text-text' : 'font-light text-text-muted',
          )}
        >
          {t('due', { count: day.count })}
        </span>
      </IntentLink>
    </li>
  );
}
