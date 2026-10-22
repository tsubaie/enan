'use client';
import { useState, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { SaveStatus } from '@/ui/layout/SaveStatus';
import { useNavigationGuard, type NavigationGuard } from './navigation';
import { useSaveQueue } from './use-save-queue';
import { UnsavedEntityDialog } from './EntityDialogs';
import { useRemove } from './use-remove';
import type { Entity, DetailApi, EntityPageProps, Neighbors, SaveState } from './types';
type Props<T extends Entity, P extends object, C> = {
  item: T;
  mutations: EntityPageProps<T, P, C>['mutations'];
  render: (item: T, api: DetailApi<P>) => ReactNode;
  name: string;
  deletedMessage: string;
  reload: () => Promise<T | undefined>;
  close: () => void;
  move: (direction: number) => void;
  neighbors: Neighbors;
  // EP-B44: the expanded field, carried in the URL by the page; a nested panel has neither.
  focus?: string;
  setFocus?: (key: string | null) => void;
};
const noFocus = () => undefined;
export function EntityPanel<T extends Entity, P extends object, C>(props: Props<T, P, C>) {
  const t = useTranslations('common');
  const root = useRef<HTMLDivElement>(null);
  const c = usePanelController(props, root);
  const scrolled = useHeadingGone(root);
  usePanelFocus(root, c.queue.state);
  const guarded = (action: () => void) => () => void c.navigate(action);
  return (
    <>
      <PanelToolbar
        state={c.queue.state}
        close={guarded(props.close)}
        name={scrolled ? props.name : null}
        scrolled={scrolled}
      />
      <div ref={root} tabIndex={-1} className="p-4 outline-none lg:px-8 lg:pt-7 lg:pb-8">
        {c.queue.error && <ErrorPanel error={c.queue.error} />}
        {c.queue.state === 'conflict' && <p className="my-3 text-sm">{t('conflictReapply')}</p>}
        {c.queue.error && (
          <Button className="my-3" variant="outline" onClick={() => void c.queue.retry()}>
            {t(c.queue.state === 'conflict' ? 'reapply' : 'retry')}
          </Button>
        )}
        {c.error && <ErrorPanel error={c.error} />}
        {props.render(props.item, {
          save: c.queue.save,
          close: guarded(props.close),
          remove: () => void c.remove(),
          restore: () => void c.restore(),
          saveState: c.queue.state,
          retry: () => void c.queue.retry(),
          next: guarded(() => props.move(1)),
          prev: guarded(() => props.move(-1)),
          neighbors: props.neighbors,
          focus: { key: props.focus ?? '', set: props.setFocus ?? noFocus },
        })}
      </div>
      <UnsavedEntityDialog
        navigation={c.navigation}
        setNavigation={() => c.setNavigation(null)}
        queue={c.queue}
      />
    </>
  );
}
// EP-B17: focus enters the panel on the record's heading so the record is announced, and comes
// back to the panel when a control re-renders away during its own save and leaves focus on the
// document body, outside the surface the shortcuts are delegated from (EP-B06).
function usePanelFocus(root: RefObject<HTMLElement | null>, state: SaveState) {
  // sync: focus the selected entity's title after the detail surface mounts.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [root]);
  // sync: DOM focus follows the save queue's state.
  useEffect(() => {
    if (state === 'saved' && document.activeElement === document.body)
      root.current?.focus({ preventScroll: true });
  }, [root, state]);
}
// The bar only names the record once the heading it would repeat has scrolled away. An observer
// rather than a scroll listener: it reports the crossing instead of every frame of the journey.
function useHeadingGone(root: RefObject<HTMLElement | null>) {
  const [gone, setGone] = useState(false);
  // sync: the heading's visibility inside the panel's scroll container.
  useEffect(() => {
    const heading = root.current?.querySelector('h2');
    if (!heading) return;
    const observer = new IntersectionObserver(
      ([entry]) => setGone(entry ? !entry.isIntersecting : false),
      { threshold: 1 },
    );
    observer.observe(heading);
    return () => observer.disconnect();
  }, [root]);
  return gone;
}
function usePanelController<T extends Entity, P extends object, C>(
  props: Props<T, P, C>,
  root: RefObject<HTMLDivElement | null>,
) {
  const t = useTranslations('common');
  const queue = useSaveQueue(props.item, props.mutations.patch, props.reload);
  const [navigation, setNavigation] = useState<(() => void) | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Blur commits a pending field, an invalid field blocks, a failed save asks first.
  const navigate: NavigationGuard = async (proceed) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && root.current?.contains(active)) active.blur();
    // Only autosaved fields block; an empty required input in a secondary form must not.
    const invalid = root.current?.querySelector<HTMLInputElement>(
      '[data-autosave] input:invalid,[data-autosave] textarea:invalid',
    );
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    if (await queue.settle()) proceed();
    else setNavigation(() => proceed);
  };
  useNavigationGuard(navigate);
  useUnloadGuard(queue.state);
  const fail = (failure: unknown) =>
    setError(failure instanceof Error ? failure : new Error(t('error')));
  const remove = useRemove(props, queue, fail);
  const restore = async () => {
    if (!props.item.deletedOpId) return;
    await props.mutations.restore(props.item.id, props.item.deletedOpId).then(props.close, fail);
  };
  return {
    queue,
    navigation,
    setNavigation,
    error,
    navigate,
    remove,
    restore,
  };
}
function useUnloadGuard(state: SaveState) {
  // sync: warn before the browser unloads while a save is unresolved.
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (['saving', 'error', 'conflict'].includes(state)) event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [state]);
}
// The bar reads Back · name · status/position, and beside the list it closes with a cross as well.
// The labelled way out is at the start edge at every width, where a reader leaving a record looks
// for it; the cross is the dismissal of a surface, so it only exists once the panel is a slide-over
// over the list rather than the whole screen. Moving between items is the list's job.
// EP-B07 (ADR 0031): the bar carries one way out and the save state. On a phone the record is the
// whole screen and was reached by drilling into the list, so the way out is Back at the start edge;
// from 1024 px the record is a sheet over the list, and a sheet is dismissed, so the way out is a
// close button at the end edge. One control per width, never both, so the reader is never offered
// two buttons that do the same thing. Moving between records is the list's job: the panel no longer
// carries a position or previous and next.
// Apple's scroll edge effect: nothing behind the bar while the record's heading is in view; once
// content scrolls under it, a soft frosted fade appears behind the controls and dissolves towards
// the content, with no rule and no hard edge, following the sheet's rounded top (tokens.css).
function PanelToolbar({
  state,
  close,
  name,
  scrolled,
}: {
  state: SaveState;
  close: () => void;
  name: string | null;
  scrolled: boolean;
}) {
  const t = useTranslations('common');
  return (
    <div
      className={cn(
        'panel-bar sticky top-0 z-20 flex min-h-12 items-center gap-1 px-3 py-2 max-lg:pt-4',
        scrolled && 'panel-bar-scrolled',
      )}
    >
      {/* Below 1024 px the record is a sheet risen from the bottom, and the handle says it can be
          pulled down (use-sheet-dismiss). */}
      <span
        aria-hidden={true}
        className="absolute inset-x-0 top-1.5 mx-auto h-1 w-9 rounded-full bg-text-muted/40 lg:hidden"
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 ps-1 text-xs text-text-muted">
        {name && <bdi className="min-w-0 truncate text-sm font-medium text-text">{name}</bdi>}
      </div>
      {state !== 'idle' && <SaveStatus state={state} />}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('close')}
        onClick={close}
        className="rounded-full max-lg:size-9 max-lg:bg-surface-raised"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
