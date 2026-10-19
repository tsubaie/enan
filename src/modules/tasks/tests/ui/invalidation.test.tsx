// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { request } from '@/core/http/client';
import { useTaskMutations } from '../../ui/queries';
import { newClient } from './harness';
vi.mock('@/core/http/client', () => ({ request: vi.fn() }));
const taskId = '01a0a000-0000-7000-8000-000000000002';
const parentId = '01a0a000-0000-7000-8000-000000000003';
const oldCommittee = '01a0a000-0000-7000-8000-0000000000c1';
const newCommittee = '01a0a000-0000-7000-8000-0000000000c2';
const personId = '01a0a000-0000-7000-8000-0000000000a1';
const noteId = '01a0a000-0000-7000-8000-0000000000e1';
const opId = '01a0a000-0000-7000-8000-0000000000bb';
// TASKS-B15 names the query trees a task mutation must refresh; each one is seeded with a value so
// the scenario can read whether the mutation marked it stale. A tree the rule does not name is
// seeded too, as the control that proves the refresh is targeted rather than global.
const keys = {
  list: ['tasks', 'list', { view: 'all', q: '', sort: '' }],
  counts: ['tasks', 'counts', {}],
  detail: ['tasks', 'detail', taskId, false],
  parent: ['tasks', 'detail', parentId, false],
  oldCommittee: ['committees', 'detail', oldCommittee, false],
  newCommittee: ['committees', 'detail', newCommittee, false],
  committees: ['committees', 'list', { view: 'active' }],
  person: ['people', 'detail', personId, false],
  note: ['notes', 'detail', noteId, false],
  home: ['home', 'summary'],
} as const;
const control = ['kpis', 'list', { view: 'all' }];
function setup() {
  const client = newClient();
  for (const key of Object.values(keys)) client.setQueryData(key, { seeded: true });
  client.setQueryData(control, { seeded: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTaskMutations(), { wrapper });
  const stale = (key: QueryKey) => client.getQueryState(key)?.isInvalidated ?? false;
  return { mutations: result.current, stale };
}
beforeEach(() => {
  vi.mocked(request).mockResolvedValue({ data: { id: taskId }, meta: { opId } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('TASKS-B15 COMM-B07 moving a task to another committee refreshes both committees, the task trees and the parent, not unrelated pages', async () => {
  const { mutations, stale } = setup();
  expect(stale(keys.detail)).toBe(false);
  await mutations.patch(taskId, 3, { committeeId: newCommittee }, opId);
  expect(vi.mocked(request)).toHaveBeenCalledWith(
    `/tasks/${taskId}`,
    expect.anything(),
    expect.objectContaining({
      method: 'PATCH',
      body: { committeeId: newCommittee, revision: 3 },
      key: opId,
    }),
  );
  for (const [name, key] of Object.entries(keys)) expect([name, stale(key)]).toEqual([name, true]);
  expect(stale(control)).toBe(false);
});
it('TASKS-B15 completing, creating and restoring refresh the same trees even when the request fails', async () => {
  const first = setup();
  await first.mutations.complete(taskId, 2, false);
  expect(first.stale(keys.counts)).toBe(true);
  expect(first.stale(keys.person)).toBe(true);
  const second = setup();
  await second.mutations.create({
    title: 'New',
    description: null,
    status: 'inbox',
    priority: null,
    dueDate: null,
    ownerId: personId,
    sourceNoteId: noteId,
    committeeId: oldCommittee,
    parentId: null,
  });
  expect(second.stale(keys.list)).toBe(true);
  expect(second.stale(keys.oldCommittee)).toBe(true);
  expect(second.stale(keys.note)).toBe(true);
  // A refused write still refreshes: the screen must not keep an optimistic picture of a change
  // the server never made.
  vi.mocked(request).mockRejectedValueOnce(new Error('conflict'));
  const third = setup();
  await expect(third.mutations.restore(taskId, opId)).rejects.toThrow('conflict');
  expect(third.stale(keys.detail)).toBe(true);
  expect(third.stale(control)).toBe(false);
});
it('TASKS-B15 TASKS-B17 a delete reports its operation id at once and refreshes the counts the shell badge reads', async () => {
  vi.mocked(request).mockResolvedValue({ opId });
  const { mutations, stale } = setup();
  const removed = await mutations.remove(taskId, 4);
  expect(removed).toEqual({ opId });
  expect(vi.mocked(request)).toHaveBeenCalledWith(
    `/tasks/${taskId}`,
    expect.anything(),
    expect.objectContaining({ method: 'DELETE', body: { revision: 4 } }),
  );
  // The refresh is not awaited by the delete, so it is observed rather than assumed.
  await waitFor(() => expect(stale(keys.counts)).toBe(true));
  expect(stale(keys.committees)).toBe(true);
  expect(stale(control)).toBe(false);
});
