'use client';
import { useLayoutEffect, useRef } from 'react';
// The swap glide (docs/design-system.md § Reordering): when items change places each one slides
// from where it was to where it now is, instead of jumping. Measure, move back, play forward; only
// transform moves, so nothing reflows. Off under reduced motion. `order` is the items' ids in their
// current order; `register` goes on each item's element.
export function useGlide(order: string[]) {
  const boxes = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, DOMRect>());
  const key = order.join();
  useLayoutEffect(() => {
    const before = last.current;
    const now = new Map<string, DOMRect>();
    for (const [id, element] of boxes.current) now.set(id, element.getBoundingClientRect());
    last.current = now;
    if (!before.size) return;
    glide(boxes.current, before, now);
  }, [key]);
  return (id: string) => (element: HTMLElement | null) => {
    if (element) boxes.current.set(id, element);
    else boxes.current.delete(id);
  };
}
// Plays each element from where it stood (`before`) to where it stands (`now`); shared with the
// list's row reorder (src/ui/entity/use-row-reorder.ts). Off under reduced motion.
export function glide(
  boxes: Map<string, HTMLElement>,
  before: Map<string, DOMRect>,
  now: Map<string, DOMRect>,
) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const [id, element] of boxes) {
    const from = before.get(id);
    const to = now.get(id);
    if (!from || !to) continue;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }
}
