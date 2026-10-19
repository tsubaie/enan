'use client';
import { useTranslations } from 'next-intl';
import { ListChecks } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
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
          className="shrink-0"
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
