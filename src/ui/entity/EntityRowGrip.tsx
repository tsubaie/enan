'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/ui/cn';
import type { RowReorder } from './use-row-reorder';
import type { Entity, EntityPageProps } from './types';
// EP-B46: a row's two move buttons, one place earlier and one later. They sit in the row's end
// corner beside the opening button, never inside it, so pressing one never opens the record. The
// arrows point the way the row will go and mirror in Arabic, where earlier is to the right. They
// show when the row is pointed at or a button has focus, and always where nothing hovers (touch),
// because there they are the only sign the row can be moved. At a group's end the button that
// would leave the group is disabled.
const button =
  'flex size-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-raised hover:text-text disabled:pointer-events-none disabled:opacity-30';
export function EntityRowGrip<T extends Entity, P extends object, C>({
  item,
  config,
  reorder,
}: {
  item: T;
  config: EntityPageProps<T, P, C>;
  reorder: RowReorder | null;
}) {
  const t = useTranslations('common');
  if (!reorder || !config.reorder) return null;
  const name = config.reorder.handle(item);
  return (
    <span
      className={cn(
        'row-move absolute end-2 bottom-2 z-10 flex items-center gap-0.5 rounded-full bg-surface-raised/60 p-0.5 opacity-0 transition-opacity',
        'group-hover/row:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
      )}
    >
      <button
        type="button"
        aria-label={t('moveEarlier', { name })}
        disabled={reorder.saving || !reorder.neighbour(item.id, -1)}
        className={button}
        onClick={() => reorder.shift(item.id, -1)}
      >
        <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('moveLater', { name })}
        disabled={reorder.saving || !reorder.neighbour(item.id, 1)}
        className={button}
        onClick={() => reorder.shift(item.id, 1)}
      >
        <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
      </button>
    </span>
  );
}
