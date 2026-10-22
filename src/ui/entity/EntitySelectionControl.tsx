'use client';
import { useTranslations } from 'next-intl';
import { ListChecks } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import type { Entity } from './types';
import type { Surface } from './surface';
// EP-B07: the toggle into selection mode the list bar carries, offered only where the module declares a bulk action to
// take on what is selected. Leaving the mode clears the selection from the URL.
export function EntitySelectionControl<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  return (
    <>
      {config.bulkActions?.length ? (
        <Button
          variant={c.selecting ? 'secondary' : 'ghost'}
          size="icon"
          // Below 1024 px the bar gives its width to search, so selecting is a desktop task; the
          // toggle stays while selecting, so a selection opened from a link can still be left.
          className={cn('shrink-0', !c.selecting && 'max-lg:hidden')}
          aria-label={t(c.selecting ? 'doneSelecting' : 'select')}
          aria-pressed={c.selecting}
          onClick={() => {
            c.setSelecting(!c.selecting);
            c.navigate({ sel: null }, true);
          }}
        >
          <ListChecks className="size-4" />
        </Button>
      ) : null}
    </>
  );
}
