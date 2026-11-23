'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
// ADR 0072: `html[data-hydrated]` says the page a reader is looking at can take input. A streamed
// page hydrates in its own boundary, after the root and on its own schedule, so a mark in the root
// would be set too early. One mark sits in the page's boundary (PageBody) and one beside the
// recorder in the shell's own boundary (AppShell); the attribute is set only while both are
// mounted. It renders nothing and carries no context. When the page goes away (a route change)
// its mark is removed and the attribute with it, until the next page's mark mounts. The browser
// suite waits on it before a first interaction; nothing in the product reads it.
type Part = 'page' | 'shell';
const parts: readonly Part[] = ['page', 'shell'];
const mounted = new Set<Part>();
function draw() {
  const root = document.documentElement;
  if (parts.every((part) => mounted.has(part))) root.dataset.hydrated = '1';
  else delete root.dataset.hydrated;
}
export function HydrationMark({ part }: { part: Part }) {
  const pathname = usePathname();
  // sync: the `data-hydrated` attribute on <html>, re-armed on every route change.
  useEffect(() => {
    mounted.add(part);
    draw();
    return () => {
      mounted.delete(part);
      draw();
    };
  }, [part, pathname]);
  return null;
}
