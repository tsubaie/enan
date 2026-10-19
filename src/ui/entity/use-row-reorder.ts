'use client';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { useToastManager } from '@/ui/primitives/toast';
import { glide } from '@/ui/layout/use-glide';
import type { Entity, EntityPageProps } from './types';
import type { EntityController } from './use-entity-controller';
// EP-B46: rows the reader puts in their own order with two buttons on each row, one place earlier
// and one place later. A row never leaves its group, because the group is a property of the record
// (a KPI's objective) that reordering must not change behind the reader's back, so the buttons at
// a group's ends are disabled. The rows glide to their new places, the new order stays on screen
// until the write and the refetch behind it have landed, and a toast says the order was saved, or
// that it was not and the rows have gone back.
type Box = Map<string, HTMLElement>;
export function useListReorder<T extends Entity, P extends object, C>(
  config: EntityPageProps<T, P, C>,
  c: EntityController<T, P, C>,
) {
  const reorder = useRowReorder(c.list.items, config.group, config.reorder?.commit);
  useSwapMotion(reorder.boxes, reorder.order);
  const active =
    Boolean(config.reorder?.active({ view: c.state.view, sort: c.state.sort })) &&
    c.state.layout !== 'table' &&
    !c.selecting;
  return active ? reorder : null;
}
function useRowReorder<T extends Entity>(
  items: T[],
  group: ((item: T) => string | null) | undefined,
  commit: ((items: T[]) => Promise<void>) | undefined,
) {
  const [order, setOrder] = useState<string[] | null>(null);
  const boxes = useRef<Box>(new Map());
  const byId = new Map(items.map((item) => [item.id, item]));
  const current = order ?? items.map((item) => item.id);
  const groupOf = (id: string) => {
    const item = byId.get(id);
    return item && group ? group(item) : null;
  };
  const save = useSave(byId, groupOf, commit, setOrder);
  const register = (id: string) => (element: HTMLElement | null) => {
    if (element) boxes.current.set(id, element);
    else boxes.current.delete(id);
  };
  // The row's neighbour in its own group in the given direction, or null at the group's end.
  const neighbour = (id: string, step: -1 | 1) => {
    const peers = current.filter((other) => groupOf(other) === groupOf(id));
    return peers[peers.indexOf(id) + step] ?? null;
  };
  const shift = (id: string, step: -1 | 1) => {
    const target = neighbour(id, step);
    if (!target) return;
    const next = current.filter((other) => other !== id);
    next.splice(current.indexOf(target), 0, id);
    save(next, id);
  };
  return { order: current, boxes, register, neighbour, shift, saving: order !== null };
}
export type RowReorder = ReturnType<typeof useRowReorder>;
// Writes the moved row's group in its new order and says how it went.
function useSave<T extends Entity>(
  byId: Map<string, T>,
  groupOf: (id: string) => string | null,
  commit: ((items: T[]) => Promise<void>) | undefined,
  setOrder: (order: string[] | null) => void,
) {
  const t = useTranslations('common');
  const toasts = useToastManager();
  return (next: string[], moved: string) => {
    const members = next
      .filter((id) => groupOf(id) === groupOf(moved))
      .map((id) => byId.get(id))
      .filter((item): item is T => Boolean(item));
    setOrder(next);
    void Promise.resolve(commit?.(members))
      .then(() => toasts.add({ title: t('orderSaved') }))
      .catch(() => toasts.add({ title: t('orderNotSaved') }))
      .finally(() => setOrder(null));
  };
}
// The swap: when rows change places each one glides from where it was to where it now is, rather
// than jumping (measure, move back, play forward). Only transform moves, so nothing reflows. Off
// under reduced motion, where the rows simply take their new places.
function useSwapMotion(boxes: RefObject<Box>, order: string[]) {
  const last = useRef(new Map<string, DOMRect>());
  const seen = useRef('');
  const key = order.join();
  // Every change of order records where the rows stand and glides them there from where they were.
  useLayoutEffect(() => {
    const before = last.current;
    const now = new Map<string, DOMRect>();
    for (const [id, element] of boxes.current) now.set(id, element.getBoundingClientRect());
    last.current = now;
    if (seen.current === key) return;
    const first = seen.current === '';
    seen.current = key;
    if (first) return;
    glide(boxes.current, before, now);
  }, [boxes, key]);
}
