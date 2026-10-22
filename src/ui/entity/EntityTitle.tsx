'use client';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { PanelLeftClose, ChevronDown } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { HEADER_TITLE_SLOT, useShellSlot } from '@/ui/layout/shell-slot';
import { useCount } from '@/ui/format';
import { cn } from '@/ui/cn';
import type { Entity } from './types';
import type { Surface } from './surface';
// The list page's title group: the views-rail toggle, the title and, where the rail is hidden, the
// current view as a way into the filter sheet. ADR 0031: from 1024 px it sits at the leading edge
// of the shell header, the way a macOS window titles its toolbar, so the list bar below carries
// only the tools; on a phone it stays in the bar (EntityToolbar).
export function EntityTitle<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="hidden xl:inline-flex"
        aria-label={t(c.railOpen ? 'collapseViews' : 'expandViews')}
        onClick={() => c.setRailOpen(!c.railOpen)}
      >
        <PanelLeftClose className="size-4 rtl:rotate-180" />
      </Button>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2 max-lg:flex-nowrap">
        <h1 className="shrink-0 font-display text-xl leading-none font-semibold whitespace-nowrap">
          {config.title}
        </h1>
        <p className="sr-only">{config.description}</p>
        <EntityToolbarSummary config={config} controller={c} />
      </div>
    </>
  );
}
// The same group, rendered into the header's title slot once the shell has drawn it.
export function EntityTitlePortal<T extends Entity, P extends object, C>(props: Surface<T, P, C>) {
  const target = useShellSlot(HEADER_TITLE_SLOT);
  return target ? createPortal(<EntityTitle {...props} />, target) : null;
}
// The current view and its count. EP-B35: it is the way into the filter sheet, so it wears a
// chevron and says so; and it is gone wherever the rail is showing the same view and the same
// count thirty pixels away, which on a desktop it always is.
function EntityToolbarSummary<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const format = useCount();
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          // It gives way to the header's utilities, its view name ending in an ellipsis.
          'h-7 min-w-0 shrink justify-start gap-1.5 px-1.5 text-sm font-normal text-text-muted',
          c.railOpen && 'xl:hidden',
        )}
        onClick={() => c.setFiltersOpen(true)}
      >
        <span className="truncate">
          {config.filters.views.find((view) => view.id === c.state.view)?.label}
        </span>
        <span className="tabular-nums">{format(c.list.counts[c.state.view] ?? 0)}</span>
        <ChevronDown aria-hidden={true} className="size-3.5 opacity-70" />
      </Button>
      {config.filters.views
        .filter((view) => view.featured === 'compact' && view.id !== c.state.view)
        .map((view) => (
          <Button
            key={view.id}
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-full px-2 text-xs font-normal text-text-muted max-lg:hidden"
            onClick={() => c.navigate({ view: view.id }, true)}
          >
            <span>{view.label}</span>
            <span className="tabular-nums">{format(c.list.counts[view.id] ?? 0)}</span>
          </Button>
        ))}
    </>
  );
}
