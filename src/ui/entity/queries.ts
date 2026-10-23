import { useState } from 'react';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { Entity, ListResult } from './types';
// Every module's list hook turns the same shape of paged response into the same `ListResult`. That
// mapping is the framework's contract rather than each module's business, so it lives here: five
// copies of it drift, and the one that drifts is the one nobody looks at.
type Page<T> = { data: T[]; meta: { counts?: Record<string, number>; nextCursor: string | null } };
export function listResult<T extends Entity>(
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>, Error>,
): ListResult<T> {
  return {
    items: query.data?.pages.flatMap((page) => page.data) ?? [],
    counts: query.data?.pages[0]?.meta.counts ?? {},
    pending: query.isPending,
    error: query.error,
    more: query.hasNextPage,
    fetchMore: async () => {
      await query.fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
  };
}

// EP-B47: a list shown `step` rows at a time from the pages it has loaded, with the next row as its
// peek. A page is fetched only when the rows on hand run out, and the count starts over when the
// view, filter or search changes (`key`), since that is a new list.
export function useListWindow<T extends Entity>(
  list: ListResult<T>,
  step: number,
  key: string,
): ListResult<T> {
  const [shown, setShown] = useState({ key, count: step });
  // A changed key is adjusted during render, not in an effect, so the new list never shows the old count.
  const count = shown.key === key ? shown.count : step;
  if (shown.key !== key) setShown({ key, count: step });
  return {
    ...list,
    items: list.items.slice(0, count),
    peek: list.items[count],
    more: list.items.length > count || list.more,
    fetchMore: async () => {
      // One row beyond the next step, so the next peek is on hand as well.
      if (list.items.length <= count + step && list.more) await list.fetchMore();
      setShown({ key, count: count + step });
    },
  };
}
