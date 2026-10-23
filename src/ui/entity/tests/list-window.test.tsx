// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListWindow } from '@/ui/entity/queries';
import type { ListResult } from '@/ui/entity/types';

// EP-B47: a server-paged list shown a step at a time from the rows it has loaded.
type Row = { id: string; revision: number; deletedAt: null; deletedOpId: null };
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    revision: 1,
    deletedAt: null,
    deletedOpId: null,
  }));
const list = (items: Row[], more: boolean, fetchMore = vi.fn(async () => {})): ListResult<Row> => ({
  items,
  counts: {},
  pending: false,
  error: null,
  more,
  fetchMore,
  refetch: () => {},
});

it('EP-B47 a loaded page shows twenty, the next as its peek, and fetches only when the rows run out', async () => {
  const fetchMore = vi.fn(async () => {});
  const { result, rerender } = renderHook(({ source, key }) => useListWindow(source, 20, key), {
    initialProps: { source: list(rows(50), true, fetchMore), key: 'all' },
  });
  expect(result.current.items).toHaveLength(20);
  expect(result.current.peek?.id).toBe('row-20');
  expect(result.current.more).toBe(true);
  await act(() => result.current.fetchMore());
  expect(result.current.items).toHaveLength(40);
  expect(fetchMore).not.toHaveBeenCalled();
  // Forty shown of fifty loaded: the next twenty need the next page.
  await act(() => result.current.fetchMore());
  expect(fetchMore).toHaveBeenCalledOnce();
  // A new view, filter or search is a new list: it starts over at twenty.
  rerender({ source: list(rows(50), true, fetchMore), key: 'today' });
  expect(result.current.items).toHaveLength(20);
});

it('EP-B47 the last rows of the last page leave no peek and nothing more', () => {
  const { result } = renderHook(() => useListWindow(list(rows(15), false), 20, 'all'));
  expect(result.current.items).toHaveLength(15);
  expect(result.current.peek).toBeUndefined();
  expect(result.current.more).toBe(false);
});
