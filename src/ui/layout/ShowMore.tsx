'use client';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/ui/primitives/button';

// EP-B47: every long list shows more the same way: a button the reader presses, never rows that
// arrive by themselves while scrolling, so what sits below the list stays within reach. Beside it,
// one status line says how many are shown, of how many when that is known. Where the next row is
// already on the page, it shows beneath the list cut short and fading out (`peek`), so the list
// reads as going on; it is not part of the list, to a pointer, the keyboard or a screen reader.
export function ShowMore({
  shown,
  total,
  more,
  onMore,
  peek,
}: {
  shown: number;
  total?: number;
  more: boolean;
  onMore: () => void | Promise<object | void>;
  peek?: ReactNode;
}) {
  const t = useTranslations('common');
  const [pending, setPending] = useState(false);
  if (!more) return null;
  const press = async () => {
    setPending(true);
    try {
      await onMore();
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="grid justify-items-center gap-1 pb-4">
      {peek && (
        <div className="show-more-peek w-full" inert aria-hidden>
          {peek}
        </div>
      )}
      <Button
        variant="ghost"
        className="mt-3 min-h-11"
        disabled={pending}
        onClick={() => void press()}
      >
        {t('more')}
        {/* The words carry the meaning; the chevron says the rest appears here, below. */}
        <ChevronDown className="size-4" aria-hidden />
      </Button>
      <p role="status" className="text-xs font-light text-text-muted">
        {total === undefined ? t('showingCount', { shown }) : t('showing', { shown, total })}
      </p>
    </div>
  );
}

// EP-B47: a list that already holds every row shows the first `step` and then `step` more a press.
export function useShowMore<T>(rows: readonly T[], step: number) {
  const [count, setCount] = useState(step);
  const visible = rows.slice(0, count);
  return {
    visible,
    peek: rows[count],
    props: {
      shown: visible.length,
      total: rows.length,
      more: rows.length > count,
      onMore: () => setCount((current) => current + step),
    },
  };
}
