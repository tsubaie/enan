'use client';
import { useState, useEffect, useCallback, type RefObject } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { resolveUrlState, changeUrl, clearEntityFilters, withDefaultView } from './url-state';
import type { Entity, EntityPageProps, FiltersDef } from './types';
import { useEntityNavigation } from './navigation';
import { useEntityNeighbors } from './use-entity-neighbors';
import { useEntityKeyboard } from './use-entity-keyboard';
import { usePointerAway } from './use-pointer-away';
import { useEntityLayout } from './use-layout';
import { setSearchScope } from '@/ui/layout/search-palette-store';
export function useEntityController<T extends Entity, P extends object, C>(
  props: EntityPageProps<T, P, C>,
  root: RefObject<HTMLElement | null>,
) {
  const path = usePathname();
  const params = useSearchParams();
  const guarded = useEntityNavigation();
  const { state, fallback, learn } = useUrlState(params);
  const sort = state.sort || (props.filters.sort?.default ?? '');
  const facets = Object.fromEntries(
    keyedFilters(props.filters).map((f) => [f.key, params.get(f.key) ?? '']),
  );
  const list = props.useList({ view: state.view, q: state.q, sort, ...facets });
  const detail = props.useDetail(state.id, state.view === 'trash');
  const selected = (params.get('sel') ?? '').split(',').filter(Boolean);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [searchReset, setSearchReset] = useState(0);
  const navigate = useGuardedNavigate(guarded, path, fallback);
  const close = useCallback(() => navigate({ id: null, new: null }), [navigate]);
  const neighbors = useEntityNeighbors(list, state.id, navigate);
  if (!state.id && !state.creating) learn(list.defaultView);
  useSearchScope(props.title, navigate);
  useControllerKeyboard(root, {
    list,
    focused,
    setFocused,
    navigate,
    close,
    panel: Boolean(state.id || state.creating),
    selected,
    selectable: Boolean(props.bulkActions?.length),
    setSelecting,
  });
  const { creating, submit } = useEntityCreate(props.mutations.create, navigate);
  const offered = Boolean(props.renderers.columns?.length);
  const { layout, setLayout } = useEntityLayout(props.module, state.layout, offered, navigate);
  return {
    state: { ...state, sort, layout },
    setLayout,
    facets,
    searchReset,
    clearFilters: (id: string | null = null) => {
      setSearchReset((value) => value + 1);
      navigate({ ...clearEntityFilters(Object.keys(facets)), id }, true);
    },
    selecting: selecting || selected.length > 0,
    setSelecting,
    ...{ railOpen, setRailOpen },
    list,
    detail,
    ...{ selected, filtersOpen, setFiltersOpen },
    ...{ creating, setFocused, navigate, close },
    move: neighbors.move,
    neighbors,
    submit,
  };
}
export type EntityController<T extends Entity, P extends object, C> = ReturnType<
  typeof useEntityController<T, P, C>
>;

// EP-B30: every piece of state in this URL — the view, the filters, the open record, the selection
// — is read by this client surface and by nothing on the server. Routing it through the router made
// each of them a server round-trip for a route whose output never changes, which is why opening a
// record fetched the page again before the panel appeared. The native history methods integrate
// with the router and with `useSearchParams` (Next's linking guide, § Native History API), so back
// and forward still work and the address bar still says what is on screen, without asking the
// server to re-render a page it has no say in.
// `defaultView` is the view on screen that the address does not name yet: the reader's first
// action records it, so the address says what is on screen from then on.
function useGuardedNavigate(
  guarded: (action: () => void) => void,
  path: string,
  defaultView: string | null,
) {
  return useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      const query = changeUrl(withDefaultView(window.location.search, defaultView), patch);
      const url = `${path}${query ? '?' + query : ''}`;
      guarded(() => window.history[replace ? 'replaceState' : 'pushState'](null, '', url));
    },
    [guarded, path, defaultView],
  );
}
type KeyboardArgs<T extends Entity> = {
  list: { items: T[] };
  focused: number;
  setFocused: (index: number) => void;
  navigate: (patch: Record<string, string | null>, replace?: boolean) => void;
  close: () => void;
  panel: boolean;
  selected: string[];
  selectable: boolean;
  setSelecting: (value: boolean) => void;
};
function useControllerKeyboard<T extends Entity>(
  root: RefObject<HTMLElement | null>,
  args: KeyboardArgs<T>,
) {
  usePointerAway(root, { panel: args.panel, close: args.close });
  useEntityKeyboard(root, {
    items: args.list.items,
    focused: args.focused,
    setFocused: args.setFocused,
    navigate: args.navigate,
    close: args.close,
    panel: args.panel,
    selected: args.selected,
    selectable: args.selectable,
    select: () => args.setSelecting(true),
    clear: () => {
      args.navigate({ sel: null }, true);
      args.setSelecting(false);
    },
    openBulk: () => {
      args.setSelecting(true);
      root.current?.querySelector<HTMLElement>('[data-entity-bulk] button')?.focus();
    },
  });
}
// SEARCH-B12: while this list is on screen, the workspace palette can hand it a phrase. The list
// registers what it is called and how to take a query, and withdraws when it leaves the screen.
function useSearchScope(
  label: string,
  navigate: (patch: Record<string, string | null>, replace?: boolean) => void,
) {
  // sync: external system — the palette store shared with the shell header.
  useEffect(() => {
    setSearchScope({ label, search: (q) => navigate({ q }) });
    return () => setSearchScope(null);
  }, [label, navigate]);
}
// EP-B30, #59: the list's state from the address, with the module's default view once its counts
// name it. The default is held here, not written into the address when it arrives: by then the
// reader may already have tapped elsewhere, and a history entry written while that navigation is in
// flight pulls them back to this list. Their next action on the list records it (useGuardedNavigate).
function useUrlState(params: URLSearchParams) {
  const [known, setKnown] = useState<string | null>(null);
  const resolved = resolveUrlState(new URLSearchParams(params));
  const fallback = !params.has('view') && !params.has('q') ? known : null;
  return {
    state: { ...resolved, view: fallback ?? resolved.view },
    fallback,
    // Called while rendering, as React's state-from-props pattern does; it settles in one pass.
    learn: (view: string | undefined) => {
      if (view && view !== known) setKnown(view);
    },
  };
}
function useEntityCreate<T extends Entity, C>(
  create: (input: C) => Promise<T | null>,
  navigate: (patch: Record<string, string | null>) => void,
) {
  const [creating, setCreating] = useState(false);
  const submit = async (input: C) => {
    setCreating(true);
    try {
      const item = await create(input);
      if (item) navigate({ id: item.id, new: null });
      return item;
    } finally {
      setCreating(false);
    }
  };
  return { creating, submit };
}

// EP-B28: everything the list is read with that lives under its own URL key. The mode is not a
// filter, but its state is kept the same way, so it is collected here rather than threaded
// separately through the query, the clearing and the cursor.
function keyedFilters(filters: FiltersDef) {
  return [...(filters.facets ?? []), ...(filters.mode ? [filters.mode] : [])];
}
