'use client';
import { Suspense, useRef } from 'react';
import { CirclePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/ui/primitives/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/ui/primitives/dialog';
import { cn } from '@/ui/cn';
import { useEntityController } from './use-entity-controller';
import { useSheetDismiss } from './use-sheet-dismiss';
import { EntityNavigationProvider } from './navigation';
import { EntityToolbar, EntitySort } from './EntityControls';
import { EntityOutside } from './EntityOutside';
import { EntityFacets } from './EntityFacets';
import { EntityViews, EntityStats } from './EntityViews';
import { EntityModeHeader } from './EntityModes';
import { EntityList } from './EntityList';
import { EntityContent, EntityDetailSkeleton } from './EntityContent';
import type { Entity, EntityPageProps } from './types';
import type { Surface } from './surface';
export function EntityPage<T extends Entity, P extends object, C>(props: EntityPageProps<T, P, C>) {
  return (
    <EntityNavigationProvider>
      <EntitySurface {...props} />
    </EntityNavigationProvider>
  );
}
// EP-B22: the primary action sits at the head of the rail on every module that is showing one.
// The toolbar keeps it for every width that has no rail, so there is always exactly one Create on
// screen and which one it is never depends on how the rows happen to be drawn.
function EntityRail<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: {
  config: EntityPageProps<T, P, C>;
  controller: ReturnType<typeof useEntityController<T, P, C>>;
}) {
  const t = useTranslations('common');
  return (
    // ADR 0031: the views rail is the main menu's sibling: the same rounded panel, the same rows, the
    // same current-item treatment. It is a solid inset panel rather than glass, because it sits on
    // the page and glass is never laid on glass.
    <aside className="entity-rail my-4 hidden w-[208px] shrink-0 overflow-y-auto rounded-2xl border bg-bg/50 p-2 xl:block">
      <Button className="mb-3 w-full" onClick={() => c.navigate({ new: '1' })}>
        <CirclePlus className="size-4" aria-hidden={true} />
        {t('create')}
      </Button>
      <h2 className="mb-1 px-3 text-xs text-text-faint">{t('views')}</h2>
      <EntityViews config={config} controller={c} />
    </aside>
  );
}
// From 1024 px the rail is an inset panel beside the list, which sits on the page ground (ADR 0030,
// ADR 0031); the list column opens with one bar
// carrying the title, current view, search, filters and Create (EP-B07).
// EP-B26: from 1024 px the detail is a slide-over. It leaves the flex row entirely -- fixed, not
// absolute -- so it is measured against the viewport rather than against the workspace, and runs
// the full height of the window over the shell header as well as the page. The list keeps the
// width it had before the record opened and no row moves when one is clicked. Only the inner side
// is an edge, so only it carries a border, and it is square: the panel meets three sides of the
// window, and a radius there would round a corner that has nothing to be a corner against. The panel is not modal: nothing is
// inert behind it, the list scrolls and tabs as it always did, and Esc still closes (EP-B06). The
// width is the measure it had as a column -- 480 px floor, 880 px ceiling -- because that is what
// a property form reads at; the percentage now reads against the window it covers.
function EntitySurface<T extends Entity, P extends object, C>(props: EntityPageProps<T, P, C>) {
  const t = useTranslations('common');
  const root = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const c = useEntityController(props, root);
  const panel = c.state.id || c.state.creating;
  const dismiss = useSheetDismiss(sheet, Boolean(panel), c.close);
  return (
    <section
      ref={root}
      className={cn(
        'entity-page min-w-0',
        panel && 'entity-page-open',
        c.state.creating && 'entity-page-creating',
      )}
    >
      <div className="entity-workspace flex min-h-0 flex-1 overflow-hidden min-[32rem]:ps-6 lg:gap-6">
        {c.railOpen && <EntityRail config={props} controller={c} />}
        <div data-entity-list className="@container min-w-0 flex-1 overflow-y-auto">
          <EntityToolbar config={props} controller={c} />
          <EntityModeHeader config={props} controller={c} />
          <EntityStats config={props} controller={c} />
          <EntityList config={props} controller={c} />
        </div>
        {/* EP-B23 (ADR 0031): behind an open record the whole window blurs and dims a little, so the
            record alone is in focus. From 1024 px it only paints: clicks still reach the list
            beneath it. Below that the record is a sheet, and tapping the dimmed page above it
            closes it, as any sheet closes; the sheet's own close button is the keyboard's way. */}
        {panel && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('close')}
            className="entity-backdrop fixed inset-0 z-[29] cursor-default max-lg:z-[39] lg:pointer-events-none"
            onClick={dismiss}
          />
        )}
        {panel && (
          <aside
            ref={sheet}
            className="entity-detail min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-surface lg:fixed lg:inset-y-2 lg:end-2 lg:z-30 lg:w-[clamp(480px,46%,880px)] lg:rounded-[20px] lg:border lg:[box-shadow:var(--shadow-slideover)]"
          >
            <EntityOutside config={props} controller={c} />
            {/* A module's record and create form load on first use. Their own boundary keeps that
                wait inside the panel; without it the route's loading screen replaced the whole page
                the first time a record was opened. */}
            <Suspense fallback={<EntityDetailSkeleton />}>
              <EntityContent config={props} controller={{ ...c, close: dismiss }} />
            </Suspense>
          </aside>
        )}
      </div>
      <EntityFilterSheet config={props} controller={c} />
    </section>
  );
}
// Filters, views and, below 1024 px, the sort, in one sheet.
function EntityFilterSheet<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  return (
    <Dialog open={c.filtersOpen} onOpenChange={c.setFiltersOpen}>
      <DialogContent sheet className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle>{t('filter')}</DialogTitle>
        <DialogDescription>{t('filterDescription')}</DialogDescription>
        {/* Below 1024 px the toolbar has no room for the sort, so it opens here with the filters. */}
        {config.filters.sort && (
          <div className="grid gap-2 lg:hidden">
            <h2 className="font-medium">{t('sort')}</h2>
            <EntitySort config={config} controller={c} />
          </div>
        )}
        <EntityFacets config={config} controller={c} />
        <h2 className="border-t pt-4 font-medium">{t('views')}</h2>
        <EntityViews config={config} controller={c} />
        <Button variant="outline" onClick={() => c.clearFilters()}>
          {t('clear')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
