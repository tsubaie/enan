'use client';
import { Fragment, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { IntentLink } from '@/ui/layout/IntentLink';
import { CirclePlus } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { useLongDate, useToday } from '@/ui/format';
import { routes } from '@/core/routes';
import type { Section, SectionKey } from './home-sections';

// HOME-B07: the page opens on the day and on what needs the principal, and every number in the
// headline is one the reader can find below it: the tasks due today and overdue (the Actions
// tile), the KPIs needing attention and the initiatives at risk (their tiles). Waiting work is
// someone else's to move and is not counted. Each count is a link into that work (HOME-B05), set
// in the accent, which follows the wallpaper. "Nothing needs you today" is said only when every
// one of those is zero. The headline is the page's one moving, memorable element (HOME-B12).
type PartKey = 'headline_today' | 'headline_overdue' | 'headline_kpis' | 'headline_initiatives';
const parts: readonly { key: SectionKey; label: PartKey }[] = [
  { key: 'today', label: 'headline_today' },
  { key: 'overdue', label: 'headline_overdue' },
  { key: 'kpis', label: 'headline_kpis' },
  { key: 'initiatives', label: 'headline_initiatives' },
];
export function Greeting({ live }: { live: Section[] }) {
  const t = useTranslations('home');
  const date = useLongDate();
  const today = useToday();
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0 max-w-2xl">
        <p className="text-sm text-text-muted">{date(today)}</p>
        <h1 className="home-headline mt-3 text-start text-title leading-snug font-light text-balance">
          <Headline live={live} />
        </h1>
      </div>
      {/* HOME-B16: one quick capture, the list page's own create sheet. */}
      {live.some((section) => section.key === 'today') && (
        <Button nativeButton={false} render={<IntentLink href={routes.tasks({ new: '1' })} />}>
          <CirclePlus className="size-4" aria-hidden />
          {t('addTask')}
        </Button>
      )}
    </header>
  );
}
function Headline({ live }: { live: Section[] }) {
  const t = useTranslations('home');
  const locale = useLocale();
  if (!live.some((section) => section.key === 'today')) return t('title');
  const counted = parts.flatMap(({ key, label }) => {
    const section = live.find((item) => item.key === key);
    return section && section.count > 0 ? [{ section, label }] : [];
  });
  if (counted.length === 0) return t('headline_clear');
  const total = counted.reduce((sum, { section }) => sum + section.count, 0);
  // The parts are joined the way the reader's language joins a list ("a, b and c", "أ وب وج"):
  // placeholders go through Intl.ListFormat and are swapped back for their links.
  const joined = new Intl.ListFormat(locale, { type: 'conjunction' }).formatToParts(
    counted.map((_, index) => String(index)),
  );
  return (
    <>
      {joined.map((part, index) => {
        const entry = part.type === 'element' ? counted[Number(part.value)] : undefined;
        return entry ? (
          <Part key={entry.section.key} section={entry.section} label={entry.label} />
        ) : (
          <Fragment key={`sep-${index}`}>{part.value}</Fragment>
        );
      })}{' '}
      {t('headline_tail', { count: total })}
    </>
  );
}
function Part({ section, label }: { section: Section; label: PartKey }) {
  const t = useTranslations('home');
  const text = t.rich(label, {
    count: section.count,
    n: (chunks: ReactNode) => (
      <span className="font-normal text-accent tabular-nums">{chunks}</span>
    ),
  });
  if (!section.href) return <span>{text}</span>;
  return (
    <IntentLink
      href={section.href}
      className="underline-offset-4 transition-colors duration-150 hover:underline"
    >
      {text}
    </IntentLink>
  );
}
