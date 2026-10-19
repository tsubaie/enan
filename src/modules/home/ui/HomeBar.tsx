import { Check } from 'lucide-react';
import { Meter } from '@/ui/layout/Meter';
import { useCount } from '@/ui/format';
// HOME-B09: how far a committee has got, in the compact form the row's other facts already use.
export function Progress({ done, open }: { done: number; open: number }) {
  const count = useCount();
  const total = done + open;
  if (total === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted">
      <Check className="size-3 shrink-0 text-accent" aria-hidden />
      <Meter filled={done} total={total} tone="accent" />
      <span className="tabular-nums">
        {count(done)}/{count(total)}
      </span>
    </span>
  );
}
