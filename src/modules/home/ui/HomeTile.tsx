'use client';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { IntentLink } from '@/ui/layout/IntentLink';
import { cn } from '@/ui/cn';
// HOME-B15: every block on the page is one widget of the same frosted glass the list pages draw
// their cards in (`.entity-glass`), with one radius, one inset and one header. The tile itself is
// not a control, so it does not answer the pointer; its rows and links do.
export function Tile({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        'home-tile entity-glass glass-static flex min-w-0 flex-col rounded-2xl border bg-bg/50 p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}
// The tile's head: the heading with whatever states its size beside it, and the way into the
// module at the end edge. No rule under it: the space and the heading's weight separate it.
export function TileHead({
  title,
  href,
  quiet = false,
  children,
}: {
  title: string;
  href: string | null;
  quiet?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations('home');
  return (
    <div className="flex h-7 items-center justify-between gap-4">
      <div className="flex min-w-0 items-baseline gap-x-3">
        <h2
          className={cn(
            'min-w-0 truncate text-start text-heading leading-7 font-normal',
            quiet && 'text-text-muted',
          )}
        >
          {title}
        </h2>
        {children}
      </div>
      {href && (
        <IntentLink
          className="home-hit shrink-0 text-xs font-light text-text-muted transition-colors duration-150 hover:text-accent focus-visible:text-accent"
          href={href}
        >
          {t('viewAll')}
        </IntentLink>
      )}
    </div>
  );
}
