// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { request } from '@/core/http/client';
import { useTaskMutations } from '@/modules/tasks/ui/queries';
import { useNoteMutations } from '@/modules/notes/ui/queries';
import { useCommitteeMutations } from '../../ui/queries';
import { newClient } from './harness';
vi.mock('@/core/http/client', () => ({ request: vi.fn() }));
const oldCommittee = '01a0a000-0000-7000-8000-0000000000c1';
const newCommittee = '01a0a000-0000-7000-8000-0000000000c2';
const taskId = '01a0a000-0000-7000-8000-000000000002';
const noteId = '01a0a000-0000-7000-8000-0000000000e1';
const opId = '01a0a000-0000-7000-8000-0000000000bb';
// COMM-B07: the committee trees a mutation elsewhere must refresh. Both the committee the work
// leaves and the one it joins are seeded, with the list the cards and their stats come from, and
// the activity feed that gains an entry. An unrelated tree is the control.
const keys = {
  oldDetail: ['committees', 'detail', oldCommittee, false],
  newDetail: ['committees', 'detail', newCommittee, false],
  list: ['committees', 'list', { view: 'active', q: '', sort: '' }],
  activity: ['committees', 'activity', oldCommittee],
  choices: ['committees', 'choices', null],
} as const;
const control = ['kpis', 'list', { view: 'all' }];
function setup<T>(hook: () => T) {
  const client = newClient();
  for (const key of Object.values(keys)) client.setQueryData(key, { seeded: true });
  client.setQueryData(control, { seeded: true });
  client.setQueryData(['tasks', 'list', { committeeId: oldCommittee }], { seeded: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(hook, { wrapper });
  const stale = (key: QueryKey) => client.getQueryState(key)?.isInvalidated ?? false;
  const allStale = () =>
    Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, stale(key)]));
  return { mutations: result.current, stale, allStale };
}
const everything = Object.fromEntries(Object.keys(keys).map((name) => [name, true]));
beforeEach(() => {
  vi.mocked(request).mockResolvedValue({ data: { id: taskId } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("COMM-B07 COMM-A02 moving a task between committees refreshes both committees' details and the committee list", async () => {
  const { mutations, allStale, stale } = setup(useTaskMutations);
  expect(allStale()).toEqual(Object.fromEntries(Object.keys(keys).map((name) => [name, false])));
  await mutations.patch(taskId, 2, { committeeId: newCommittee }, opId);
  expect(allStale()).toEqual(everything);
  expect(stale(control)).toBe(false);
});
it('COMM-B07 COMM-A01 creating a task under a committee, or clearing its committee, refreshes the committee trees', async () => {
  const created = setup(useTaskMutations);
  await created.mutations.create({
    title: 'From the tab',
    description: null,
    status: 'inbox',
    priority: null,
    dueDate: null,
    ownerId: null,
    sourceNoteId: null,
    committeeId: oldCommittee,
    parentId: null,
  });
  expect(created.allStale()).toEqual(everything);
  const cleared = setup(useTaskMutations);
  await cleared.mutations.patch(taskId, 3, { committeeId: null }, opId);
  expect(cleared.allStale()).toEqual(everything);
  // Completing changes the open and overdue figures on the card, so it refreshes them too.
  vi.mocked(request).mockResolvedValue({ data: { id: taskId }, meta: { opId } });
  const completed = setup(useTaskMutations);
  await completed.mutations.complete(taskId, 3, false);
  expect(completed.allStale()).toEqual(everything);
});
it("COMM-B07 a note that joins or leaves a committee refreshes that committee's detail, list and activity", async () => {
  const joined = setup(useNoteMutations);
  await joined.mutations.patch(noteId, 1, { committeeId: newCommittee }, opId);
  expect(joined.allStale()).toEqual(everything);
  expect(joined.stale(control)).toBe(false);
  const created = setup(useNoteMutations);
  await created.mutations.create({
    title: 'Minutes',
    content: '',
    type: null,
    noteDate: null,
    tags: [],
    participantIds: [],
    committeeId: oldCommittee,
  });
  expect(created.allStale()).toEqual(everything);
  // Trashing a note is the one write that answers before the refresh, so it is observed.
  vi.mocked(request).mockResolvedValue({ opId });
  const removed = setup(useNoteMutations);
  await removed.mutations.remove(noteId, 2);
  await waitFor(() => expect(removed.allStale()).toEqual(everything));
});
it("COMM-B07 COMM-B04 a committee's own writes refresh its list and detail and the task lists its tabs show", async () => {
  const archived = setup(useCommitteeMutations);
  await archived.mutations.patch(oldCommittee, 1, { status: 'archived' }, opId);
  expect(archived.allStale()).toEqual(everything);
  expect(archived.stale(['tasks', 'list', { committeeId: oldCommittee }])).toBe(true);
  expect(archived.stale(control)).toBe(false);
  vi.mocked(request).mockResolvedValue({ opId });
  const removed = setup(useCommitteeMutations);
  expect(await removed.mutations.remove(oldCommittee, 2)).toEqual({ opId });
  await waitFor(() => expect(removed.allStale()).toEqual(everything));
});
