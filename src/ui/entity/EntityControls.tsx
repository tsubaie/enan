'use client';
import { useTranslations } from 'next-intl';
import { SlidersHorizontal, CirclePlus, Plus, X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { EntitySearch } from './EntitySearch';
import { EntityModes } from './EntityModes';
import { EntityBulkBar } from './EntityBulkBar';
import { EntitySelectionControl } from './EntitySelectionControl';
import { EntityTitlePortal } from './EntityTitle';
import { ChoiceSelect } from '@/ui/layout/ChoiceSelect';
import { cn } from '@/ui/cn';
import { useCount } from '@/ui/format';
import type { Entity } from './types';
import type { Surface } from './surface';

// EP-B22: one header, the same on every entity surface. Create used to move into the views rail
// for card lists and stay in the bar for everything else, which made where the primary action
// lives a function of how the rows happen to be drawn — two modules of the same framework putting
// it in two places. It is at the head of the rail on all of them now, and the bar carries it only
// where there is no rail to carry it: a heading row with a lone button at the far end leaves a
// thousand pixels of nothing between the two on a wide screen.
//
// EP-B32: the title and the controls are two flex items of one wrapping row, not two rows. They
// share a line wherever the list is wide enough to hold both and the controls drop below the title
// where it is not, so the bar is one row on a desktop and two on a phone without either width
// being written down. It was two rows at every width before, and on a 390 px screen that put 359 px
// of header over two and a half task rows.
// The title takes only the width it needs once there is a row to share, so the spare goes to the
// controls rather than to the gap after the heading -- a module carrying a mode as well as a sort
// (KPIs) needs all of it to stay on one line. Below that it grows again, which is what holds
// Create against the end edge of a phone.
export function EntityToolbar<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  return (
    // EP-B40: the bar pays for itself in rows. Where it has to wrap — a phone, or the list beside
    // an open record — the padding and the gap between its lines come in a step, because three
    // wrapped rows at desktop spacing cost 24 px of a screen that has 732 px for records.
    <div className="entity-toolbar sticky top-0 z-10 space-y-2 border-b bg-surface px-3 py-2 @lg:space-y-3 @lg:pe-6 @lg:ps-0 @lg:py-4">
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-2 @lg:gap-y-3">
        {/* The title group sits in the shell header at every width (ADR 0031). Below 1024 px this
            group would hold Create alone on a row of its own, so Create joins the controls there. */}
        <EntityTitlePortal config={config} controller={c} />
        <div className="flex min-w-0 flex-1 basis-auto items-center gap-2 max-lg:hidden @lg:flex-none">
          <Button
            className={cn('shrink-0', c.railOpen && 'xl:hidden')}
            onClick={() => c.navigate({ new: '1' })}
          >
            <CirclePlus className="size-5" strokeWidth={2.25} />
            {t('create')}
          </Button>
        </div>
        <EntityToolbarControls config={config} controller={c} />
      </div>
      {config.bulkActions?.length && c.selecting && c.selected.length > 0 ? (
        <EntityBulkBar
          items={c.list.items.filter((item) => c.selected.includes(item.id))}
          actions={config.bulkActions}
          clear={() => {
            c.navigate({ sel: null }, true);
            c.setSelecting(false);
          }}
        />
      ) : null}
    </div>
  );
}
// What the Filter button reports and what Clear has to clear are two different questions.
// EP-B33 a sort is neither: it reorders the list and never shortens it. EP-B28 the mode is the
// second: it shares the facets' URL key and their clearing and is still not a filter, so it is
// cleared but not counted -- which is also why a change of period no longer grows the button by a
// badge and shifts everything sharing the row with it.
function narrowing<T extends Entity, P extends object, C>(
  config: Surface<T, P, C>['config'],
  c: Surface<T, P, C>['controller'],
) {
  const mode = config.filters.mode?.key;
  const count = Object.entries(c.facets).filter(([key, value]) => value && key !== mode).length;
  const active = Boolean(mode && c.facets[mode]);
  return { count, filtered: count > 0 || active || Boolean(c.state.q) || c.state.view !== 'all' };
}

// Search, filters and selection mode; wraps under the title when the list column is narrow
// (a phone, or the desktop list beside an open detail).
//
// EP-B34: while a record is open the panel covers the end of the list, and everything under it was
// still focusable — Tab walked into controls nobody could see. The bar keeps only what fits in the
// strip the panel leaves: search and Filter. The rest are list-wide settings the reader is not
// adjusting while working on one record, and they come back the moment it closes.
function EntityToolbarControls<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  const covered = Boolean(c.state.id || c.state.creating);
  const { count, filtered } = narrowing(config, c);
  const shown = useCount();
  return (
    <div className="flex min-w-0 flex-[2_1_30rem] flex-wrap items-center gap-2 max-lg:flex-nowrap">
      <div className="flex min-w-0 flex-1 basis-56 max-lg:basis-0">
        <EntitySearch
          key={c.searchReset}
          query={c.state.q}
          label={config.searchLabel}
          navigate={c.navigate}
        />
      </div>
      {/* EP-B39: the settings group wraps and gives width back like everything else in the bar. It
          was `shrink-0`, which on a module carrying a period as well as a sort (KPIs) made the
          group 509 px wide inside a 390 px screen — the sort clipped mid-word and Filter and Clear
          rendered past the edge, where nothing could reach them. */}
      <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2 max-lg:shrink-0 max-lg:flex-nowrap">
        {!covered && <EntityListSettings config={config} controller={c} />}
        <Button
          variant={count ? 'secondary' : 'outline'}
          className="shrink-0 max-lg:rounded-full max-lg:px-2.5"
          aria-label={count ? t('filtersActive', { count }) : t('filter')}
          onClick={() => c.setFiltersOpen(true)}
        >
          <SlidersHorizontal className="size-4" aria-hidden={true} />
          <span className="max-lg:hidden">{t('filter')}</span>
          {count > 0 && <span className="tabular-nums">{shown(count)}</span>}
        </Button>
        {!covered && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('shrink-0 text-text-muted', !filtered && 'invisible max-lg:hidden')}
            aria-label={t('clear')}
            title={t('clear')}
            onClick={() => c.clearFilters()}
          >
            <X aria-hidden={true} className="size-4" />
          </Button>
        )}
        <PhoneCreate create={() => c.navigate({ new: '1' })} />
      </div>
    </div>
  );
}

// Everything in the bar that is not search, Filter or Clear: how the list is drawn, the reading it
// is taken under, the order it is in, and whether rows are being picked. All of it is hidden while
// a record is open (EP-B34), so it travels together.
function EntityListSettings<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  return (
    <>
      <EntityModes config={config} controller={c} />
      {config.filters.sort && (
        <div className="min-w-0 max-w-44 max-lg:hidden">
          <EntitySort config={config} controller={c} />
        </div>
      )}
      <EntitySelectionControl config={config} controller={c} />
    </>
  );
}
// Below 1024 px Create is a round icon at the end of the controls row (the title row it sat on is
// gone: the title is in the shell header there).
function PhoneCreate({ create }: { create: () => void }) {
  const t = useTranslations('common');
  return (
    <Button
      size="icon"
      className="shrink-0 rounded-full lg:hidden"
      aria-label={t('create')}
      title={t('create')}
      onClick={create}
    >
      <Plus className="size-5" strokeWidth={2.25} aria-hidden={true} />
    </Button>
  );
}
// The list's order: in the bar from 1024 px, and in the filter sheet below it (EntityPage).
export function EntitySort<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  if (!config.filters.sort) return null;
  return (
    <ChoiceSelect
      label={t('sort')}
      value={c.state.sort}
      items={config.filters.sort.options.map((option) => ({
        value: option.id,
        text: option.label,
        label: option.label,
      }))}
      onChange={(sort) => c.navigate({ sort }, true)}
    />
  );
}
