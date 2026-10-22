'use client';
import { useTranslations } from 'next-intl';
import { LayoutGrid, Table2 } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import { segmentedItem, segmentedItemOn, segmentedTrack } from '@/ui/primitives/segmented';
import type { Entity } from './types';
import type { Surface } from './surface';
// The toolbar control that changes how the list is read rather than what is in it: the
// presentation it is drawn in (EP-B29). The reading every row is taken under (EP-B28) is the
// list's header instead (`EntityModeHeader`). Neither removes a record, which is why neither lives
// in the filter sheet.
export function EntityModes<T extends Entity, P extends object, C>(props: Surface<T, P, C>) {
  return <EntityLayout {...props} />;
}
// EP-B29: card or table, offered only where the module has declared columns to put in one. Icons
// alone: the two arrangements are the thing being chosen, and a picture of each says it faster than
// its name in any language. Both carry their label to assistive technology.
function EntityLayout<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  if (!config.renderers.columns?.length) return null;
  const options = [
    { id: '', label: t('layoutCards'), Icon: LayoutGrid },
    { id: 'table', label: t('layoutTable'), Icon: Table2 },
  ];
  // EP-B29: the choice is offered where a table can actually be read. On a 390 px phone it cannot,
  // and a control that hands the reader an unusable arrangement is worse than one that never asked.
  return (
    <div
      role="group"
      aria-label={t('layout')}
      className="hidden shrink-0 rounded-full border p-0.5 @lg:flex"
    >
      {options.map((option) => (
        <Button
          key={option.id}
          variant="ghost"
          size="sm"
          aria-label={option.label}
          aria-pressed={option.id === c.state.layout}
          className={cn(
            'h-7 px-2 text-text-muted dark:hover:bg-white/8',
            option.id === c.state.layout &&
              'bg-surface-raised text-text dark:bg-white/15 dark:hover:bg-white/15',
          )}
          onClick={() => c.setLayout(option.id)}
        >
          <option.Icon className="size-4" aria-hidden={true} />
        </Button>
      ))}
    </div>
  );
}

// EP-B28: the reading the whole list is taken under, as the list's header: a capsule segmented
// control above the figures it rewrites, sized to its options like every other segmented toggle and
// set at the start edge, where the eye begins the line (the right in Arabic). It is a
// segmented group rather than a select because the options are few, fixed and compared against
// each other, and because the record's own period toggle is this shape. It is not folded into the
// filter sheet: a filter shortens the list and this does not, and something that rewrites every
// figure on the page should be the first thing above them, not a small control beside the search.
export function EntityModeHeader<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const mode = config.filters.mode;
  if (!mode) return null;
  const current = c.facets[mode.key] ?? '';
  return (
    // Centred over the list: it rewrites every figure below it, so it belongs to the whole column.
    <div className="flex justify-center px-3 pt-1 pb-1">
      <div
        role="group"
        aria-label={mode.label}
        // Below 1024 px it spans the column like the cards under it, every option an equal share.
        className={cn(
          segmentedTrack,
          'w-fit max-w-full max-lg:grid max-lg:w-full max-lg:auto-cols-fr max-lg:grid-flow-col',
        )}
      >
        {mode.options.map((option) => (
          <Button
            key={option.id}
            variant="ghost"
            aria-pressed={option.id === current}
            className={cn(
              segmentedItem,
              'min-h-0 max-lg:min-w-0 max-lg:px-1.5',
              option.id === current && segmentedItemOn,
            )}
            onClick={() => c.navigate({ [mode.key]: option.id, id: null, sel: null }, true)}
          >
            <span className="segmented-label truncate" data-label={option.label}>
              {option.label}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
