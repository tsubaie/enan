// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// The network is the only seam: the mutation hooks are rendered against a real QueryClient whose
// cache already holds the queries the page would have, so what is asserted is which of them a
// write marks stale (NOTES-B16), not which URL it called.
const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/core/http/client', () => ({
  request: http.request,
  ApiError: class ApiError extends Error {},
}));
import { useNoteMutations } from '../../ui/queries';
import { useTaskMutations } from '@/modules/tasks/ui/queries';
const noteId = '01a09ec1-bcde-7715-bec0-f0c3ae4dbd01';
const personId = '01a09ec1-bcde-7715-bec0-f0c3ae4dbd02';
const taskId = '01a09ec1-bcde-7715-bec0-f0c3ae4dbd03';
const opId = '01a09ec1-bcde-7715-bec0-f0c3ae4dbd04';
// Every query a note mutation must reach, and two it must leave alone.
const noteKeys = {
  list: ['notes', 'list', { view: 'all' }],
  counts: ['notes', 'counts', {}],
  detail: ['notes', 'detail', noteId, false],
  tags: ['notes', 'tags'],
  home: ['home'],
  person: ['people', 'detail', personId, false],
  tasks: ['tasks', 'list', { view: 'all' }],
} as const;
const untouched = {
  kpis: ['kpis', 'list', {}],
  settings: ['settings', 'all'],
} as const;
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of [...Object.values(noteKeys), ...Object.values(untouched)])
    client.setQueryData([...key], { seeded: true });
  http.request.mockReset().mockResolvedValue({ data: { id: noteId }, meta: { opId } });
});
afterEach(() => cleanup());
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
type Key = (typeof noteKeys)[keyof typeof noteKeys] | (typeof untouched)[keyof typeof untouched];
const invalidated = (key: Key) => client.getQueryState([...key])?.isInvalidated ?? false;
function expectNoteQueriesStale() {
  for (const [name, key] of Object.entries(noteKeys))
    expect(invalidated(key), `${name} should be invalidated`).toBe(true);
  for (const [name, key] of Object.entries(untouched))
    expect(invalidated(key), `${name} should be left alone`).toBe(false);
}
it('NOTES-B16 patching a note invalidates its lists, counts, detail, tags, home and the people it names', async () => {
  const { result } = renderHook(() => useNoteMutations(), { wrapper });
  expect(Object.values(noteKeys).some(invalidated)).toBe(false);
  await act(() => result.current.patch(noteId, 1, { participantIds: [personId] }, 'key-1'));
  expect(http.request).toHaveBeenCalledWith(
    `/notes/${noteId}`,
    expect.anything(),
    expect.objectContaining({ method: 'PATCH', body: { participantIds: [personId], revision: 1 } }),
  );
  expectNoteQueriesStale();
});
it('NOTES-B16 create, archive, bulk writes and a failed write all refresh the same queries', async () => {
  const { result } = renderHook(() => useNoteMutations(), { wrapper });
  const reseed = () => {
    for (const key of Object.values(noteKeys)) client.setQueryData([...key], { seeded: true });
    expect(Object.values(noteKeys).some(invalidated)).toBe(false);
  };
  await act(() =>
    result.current.create({
      title: 'New',
      content: '',
      type: null,
      noteDate: null,
      tags: [],
      participantIds: [],
      committeeId: null,
    }),
  );
  expectNoteQueriesStale();
  reseed();
  await act(() => result.current.archive(noteId, 1, true));
  expectNoteQueriesStale();
  reseed();
  await act(() => result.current.bulkTag([{ id: noteId, revision: 1 }], 'Budget'));
  expectNoteQueriesStale();
  reseed();
  // A write the server refused may still have changed what the reader sees elsewhere (a 409
  // carries the current row), so the refresh runs on failure as well.
  http.request.mockRejectedValueOnce(new Error('conflict'));
  await expect(
    act(() => result.current.patch(noteId, 1, { title: 'Stale' }, 'key-2')),
  ).rejects.toThrow('conflict');
  expectNoteQueriesStale();
});
it('NOTES-B16 NOTES-B09 a task mutation invalidates the notes queries, so counts and panels refresh', async () => {
  const { result } = renderHook(() => useTaskMutations(), { wrapper });
  await act(() => result.current.complete(taskId, 2, false));
  // The completion reports before the refresh settles; the invalidation lands on the next tick.
  await act(() => Promise.resolve());
  for (const key of [noteKeys.list, noteKeys.counts, noteKeys.detail, noteKeys.home])
    expect(invalidated(key)).toBe(true);
  for (const key of Object.values(untouched)) expect(invalidated(key)).toBe(false);
  for (const key of Object.values(noteKeys)) client.setQueryData([...key], { seeded: true });
  await act(() => result.current.patch(taskId, 2, { sourceNoteId: noteId }, 'key-3'));
  expect(invalidated(noteKeys.detail)).toBe(true);
  expect(invalidated(noteKeys.list)).toBe(true);
});
