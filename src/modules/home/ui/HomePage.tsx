'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useHome } from './queries';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { cn } from '@/ui/cn';
import { Greeting } from './HomeGreeting';
import { Stream } from './HomeStream';
import { Actions } from './HomeActions';
import { Week } from './HomeWeek';
import { gridRank, isAction, quiet, quietKey, type QuietKey, type Section } from './home-sections';
// HOME-B15: the page sits on the list pages' see-through canvas (`.home-page`), so the tiles read
// as glass over the wallpaper rather than as boxes on a grey slab.
// On a laptop window the page should end inside the card: a few spare pixels of padding make the
// page scroll a little and wiggle under a trackpad, so the desktop spacing stays within one screen.
const page = 'home-page mx-auto max-w-[1280px] px-4 pt-8 pb-10 sm:px-6 lg:px-10 lg:pt-8 lg:pb-5';
export function HomePage() {
  const t = useTranslations('home');
  const query = useHome();
  if (query.isPending) return <HomeSkeleton />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  // HOME-B02: a module the workspace never enabled is left out entirely.
  const live: Section[] = query.data.data.sections.filter((section) => section.enabled);
  return (
    <div className={page}>
      <Greeting live={live} />
      {live.length > 0 ? (
        <Board live={live} />
      ) : (
        <div className="home-tile entity-glass glass-static mt-10 rounded-2xl border bg-bg/50 px-6 py-10 text-start">
          <p className="text-sm">{t('empty')}</p>
          <p className="mt-2 text-sm font-light text-text-muted">{t('emptyHint')}</p>
        </div>
      )}
    </div>
  );
}
// HOME-B07: the Actions tile is the real work, so it comes first at every width: the start column
// from 1024 px, the top of the page below that. Every tile sits in one grid with one gap: from
// 1024 px three equal columns, Actions running down the first column beside every row, the week
// across the other two, and the remaining tiles two to a row under it. Tiles in a row stretch to
// one height and Actions to the height of the rows beside it, so tops and bottoms line up; an odd
// last tile takes the whole row (HOME-B15). Every track has a zero minimum (HOME-B13). A tile with
// nothing in it is not drawn; those sections share one quiet line after the grid (HOME-B02).
const actionSpan: Record<number, string> = {
  1: 'lg:row-span-1',
  2: 'lg:row-span-2',
  3: 'lg:row-span-3',
  4: 'lg:row-span-4',
  5: 'lg:row-span-5',
  6: 'lg:row-span-6',
};
const lgSpan: Record<number, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};
// The last tiles widen to close their row, so no row ends on a hole.
function tileSpan(index: number, count: number, perRow: number) {
  const spare = count % perRow;
  const last = index === count - 1;
  let lg = 1;
  if (spare === 1 && last) lg = perRow;
  else if (spare === 2 && perRow === 3 && index === count - 2) lg = 2;
  return cn(last && count % 2 === 1 && 'md:col-span-2', lgSpan[lg]);
}
function Board({ live }: { live: Section[] }) {
  const bands = live.filter(isAction);
  const today = live.find((section) => section.key === 'today');
  const overdue = live.find((section) => section.key === 'overdue');
  const working = bands.some((section) => section.count > 0);
  const rest = live
    .filter((section) => !isAction(section))
    .sort((a, b) => gridRank(a) - gridRank(b));
  const tiles = rest.filter((section) => section.items.length > 0);
  const lead: QuietKey[] = bands.length > 0 && !working ? ['quiet_actions'] : [];
  const empty = lead.concat(
    rest
      .filter((section) => section.items.length === 0)
      .flatMap((section) => {
        const key = quietKey(section.key);
        return key ? [key] : [];
      }),
  );
  // Beside Actions the tiles run two to a row; without it, three.
  const perRow = working ? 2 : 3;
  const rows = (today ? 1 : 0) + Math.ceil(tiles.length / perRow);
  return (
    <>
      <div
        className={cn(
          'home-column mt-10 grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[repeat(2,minmax(0,1fr))] lg:mt-8 lg:auto-rows-fr lg:grid-cols-[repeat(3,minmax(0,1fr))]',
          // The week's row keeps its own height; the rows of tiles under it share what is left.
          today && 'lg:grid-rows-[auto]',
        )}
      >
        {working && (
          <Actions
            bands={bands}
            className={cn('md:col-span-2 lg:col-span-1', actionSpan[Math.max(rows, 1)])}
          />
        )}
        {today && (
          <Week
            today={today}
            overdue={overdue}
            className={cn('self-start md:col-span-2', !working && 'lg:col-span-3')}
          />
        )}
        {tiles.map((section, index) => (
          <Stream
            key={section.key}
            section={section}
            quiet={quiet(section)}
            className={tileSpan(index, tiles.length, perRow)}
          />
        ))}
      </div>
      <QuietLine keys={empty} />
    </>
  );
}
// The sections with nothing in them, said once, as one sentence joined the way the reader's
// language joins a list: "Nothing waiting on others and no notes this week."
function QuietLine({ keys }: { keys: QuietKey[] }) {
  const t = useTranslations('home');
  const locale = useLocale();
  if (keys.length === 0) return null;
  const text = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
    keys.map((key) => t(key)),
  );
  return (
    <p className="home-quiet mt-6 text-sm font-light text-text-muted first-letter:uppercase">
      {text}.
    </p>
  );
}
// The skeleton keeps the finished layout's shape so the page does not jump when the query lands.
function HomeSkeleton() {
  const c = useTranslations('common');
  const block = 'animate-pulse rounded-md bg-surface-raised';
  const tile = 'animate-pulse rounded-2xl border bg-bg/50';
  return (
    <div role="status" aria-label={c('loading')} className={page}>
      <div className={`h-4 w-40 ${block}`} />
      <div className={`mt-3 h-7 w-[32rem] max-w-full ${block}`} />
      <div className="mt-10 grid gap-4 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-5">
        <div className={`h-96 ${tile}`} />
        <div className="flex flex-col gap-4 lg:gap-5">
          <div className={`h-28 ${tile}`} />
          <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
            <div className={`h-60 ${tile}`} />
            <div className={`h-48 ${tile}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
