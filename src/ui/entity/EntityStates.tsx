'use client';
import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { openSearchPalette } from '@/ui/layout/search-palette-store';
import { cn } from '@/ui/cn';
import type { Entity } from './types';
import type { Surface } from './surface';
// What the list shows when it has no rows to show: the shape of the rows while the first page
// loads, and the two empty states — nothing here at all, versus nothing matching (EP-B15).
// Placeholder rows at the real row height keep the layout stable while the first page loads. A
// list drawn as cards waits as cards: the same inset sheets at the phone card's height, a name bar
// over a facts bar and the trail's circle, so the page does not change shape when the rows arrive.
export function EntityListSkeleton({ cards = false }: { cards?: boolean }) {
  const t = useTranslations('common');
  const rows = ['a', 'b', 'c', 'd', 'e', 'f'];
  if (cards) return <CardSkeleton label={t('loading')} rows={rows} />;
  return (
    <div role="status" className="animate-pulse">
      <span className="sr-only">{t('loading')}</span>
      {rows.map((row, index) => (
        <div key={row} aria-hidden className="flex h-11 items-center gap-3 border-b px-4">
          <span className="size-4 rounded-full bg-surface-raised" />
          <span
            className={cn(
              'h-3 rounded bg-surface-raised',
              index % 3 === 0 ? 'w-2/3' : index % 3 === 1 ? 'w-1/2' : 'w-3/5',
            )}
          />
          <span className="ms-auto h-3 w-12 rounded bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}
function CardSkeleton({ label, rows }: { label: string; rows: string[] }) {
  return (
    <div role="status" className="animate-pulse pt-3">
      <span className="sr-only">{label}</span>
      {rows.map((row, index) => (
        <div
          key={row}
          aria-hidden
          className="mx-3 mb-2 flex h-[var(--card-phone-height)] items-center gap-3 rounded-2xl border bg-bg/50 px-4 @lg:mx-0 @lg:me-6"
        >
          <span className="size-5 shrink-0 rounded-full bg-surface-raised" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span
              className={cn(
                'h-3 rounded bg-surface-raised',
                index % 3 === 0 ? 'w-2/3' : index % 3 === 1 ? 'w-1/2' : 'w-3/5',
              )}
            />
            <span className="h-2.5 w-1/3 rounded bg-surface-raised/70" />
          </span>
          <span className="size-7 shrink-0 rounded-full bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}
// EP-B33: a sort is not one of these. It reorders the list, it never shortens it, so an empty list
// under a chosen sort is empty for some other reason and "clear filters" would not bring a row back.
function isFiltered<T extends Entity, P extends object, C>(c: Surface<T, P, C>['controller']) {
  return Boolean(c.state.q || c.state.view !== 'all' || Object.values(c.facets).some(Boolean));
}
export function EntityEmpty<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  const filtered = isFiltered(c);
  const custom = filtered ? {} : (config.emptyState ?? {});
  const Icon = config.emptyState?.icon ?? Inbox;
  const copy = {
    title: custom.title ?? t(filtered ? 'noMatches' : 'empty'),
    description: custom.description ?? t(filtered ? 'noMatchesDescription' : 'emptyDescription'),
    action: custom.action ?? {
      label: t(filtered ? 'clear' : 'create'),
      onSelect: () => (filtered ? c.clearFilters() : c.navigate({ new: '1' })),
    },
  };
  return (
    <div className="grid justify-items-center gap-3 px-6 py-16 text-center">
      <Icon className="size-7 text-text-muted" />
      <h2 className="text-base font-medium">{copy.title}</h2>
      <p className="max-w-sm text-sm text-text-muted">{copy.description}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={copy.action.onSelect}>
          {copy.action.label}
        </Button>
        {/* EP-B41: a phrase this list does not contain may live in another module. The empty state
            says what to do next and carries the phrase over, so nobody retypes it one row up. */}
        {c.state.q && (
          <Button variant="ghost" onClick={() => openSearchPalette(c.state.q)}>
            {t('searchWorkspace')}
          </Button>
        )}
      </div>
    </div>
  );
}
