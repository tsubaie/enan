import type { ReactNode } from 'react';
import { cn } from '@/ui/cn';
// A count in a circle: one or two digits sit in a 20 px disc, more stretch it into a capsule.
// Inside a nav link (`group/nav`) the current page's circle takes the accent; elsewhere `current`
// says so. `danger` marks a count that is itself a warning, in every state.
export function CountCircle({
  children,
  current,
  danger,
}: {
  children: ReactNode;
  current?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      className={cn(
        'count-tick inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs leading-5 font-normal tabular-nums',
        danger
          ? 'bg-danger-soft text-danger'
          : current
            ? 'bg-accent-soft text-accent'
            : 'bg-[var(--nav-selected)] text-text-muted group-aria-[current=page]/nav:bg-accent-soft group-aria-[current=page]/nav:text-accent',
      )}
    >
      {children}
    </span>
  );
}
