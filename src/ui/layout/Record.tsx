import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/ui/cn';
// The pieces every record panel is built from (docs/design-system.md § Records), so a task, a note,
// a committee and a person read as one family: the title, a section with a quiet heading, and a
// section's items on an inset sheet. Sections are separated by space, never by rules.
export const recordTitle = 'font-display text-title leading-snug font-semibold';
export function RecordTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 tabIndex={-1} dir="auto" className={cn(recordTitle, 'px-2', className)}>
      {children}
    </h2>
  );
}
export function RecordSection({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 grid gap-2">
      <div className="flex min-h-8 items-center gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {meta && <span className="text-xs text-text-muted tabular-nums">{meta}</span>}
        {action && <span className="ms-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}
// A section's items on the inset sheet the properties use; each child is one row.
export function RecordList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border bg-bg/50 empty:hidden">
      {children}
    </ul>
  );
}
// The way out of a section to the whole list behind it ("View assigned tasks (12)"): the small grey
// capsule every secondary action under a section takes (a note's Link task), not a bare text link.
// It stays a link, because it goes somewhere: it only wears the capsule.
export function RecordMore({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-7 items-center gap-1.5 justify-self-start rounded-full bg-secondary px-2.5 text-xs font-light text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3 rtl:-scale-x-100" />
    </Link>
  );
}
