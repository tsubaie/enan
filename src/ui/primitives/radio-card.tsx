import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/ui/cn';
// One option of a radio list drawn as a card: the native radio, so the arrow keys, the group's name
// and the form semantics are the browser's, with its label as the whole card. The card takes the
// accent while chosen.
export function RadioCard({
  className,
  children,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { children: ReactNode }) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 has-checked:border-accent has-checked:ring-1 has-checked:ring-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
        className,
      )}
    >
      <input type="radio" className="size-4 shrink-0 accent-accent outline-none" {...props} />
      {children}
    </label>
  );
}
