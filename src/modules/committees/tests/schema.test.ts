import { expect, it } from 'vitest';
import {
  Activity,
  ActivityQuery,
  Committee,
  CommitteeChoices,
  CommitteeCreate,
  CommitteeList,
  CommitteeListQuery,
  CommitteePatch,
  CommitteeReference,
  Reorder,
  Revision,
  Scope,
  Sort,
  Status,
  View,
} from '../schema/validation';
const uuid = (n: number) => `01a0a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const stamps = {
  id: uuid(1),
  revision: 1,
  sortOrder: 0,
  createdAt: '2026-09-10T07:00:00.000Z',
  updatedAt: '2026-09-10T07:00:00.000Z',
  createdBy: null,
  updatedBy: null,
  deletedAt: null,
  deletedOpId: null,
  stats: { open: 1, completed: 2, overdue: 0, today: 1 },
  lastNoteDate: null,
};
it('COMM-B01 a committee draft trims its name, defaults to an active internal body, and keeps its caps', () => {
  expect(CommitteeCreate.parse({ name: '  Finance  ' })).toEqual({
    name: 'Finance',
    description: '',
    ownership: '',
    scope: 'internal',
    status: 'active',
  });
  expect(CommitteeCreate.safeParse({}).success).toBe(false);
  expect(CommitteeCreate.safeParse({ name: '   ' }).success).toBe(false);
  expect(CommitteeCreate.safeParse({ name: 'n'.repeat(500) }).success).toBe(true);
  expect(CommitteeCreate.safeParse({ name: 'n'.repeat(501) }).success).toBe(false);
  expect(CommitteeCreate.safeParse({ name: 'x', ownership: 'o'.repeat(501) }).success).toBe(false);
  expect(CommitteeCreate.safeParse({ name: 'x', description: 'd'.repeat(50001) }).success).toBe(
    false,
  );
  expect(CommitteeCreate.safeParse({ name: 'x', scope: 'regional' }).success).toBe(false);
  expect(CommitteeCreate.safeParse({ name: 'x', status: 'dissolved' }).success).toBe(false);
  // Closed body: a field the contract does not name is refused, not dropped.
  expect(CommitteeCreate.safeParse({ name: 'x', sortOrder: 3 }).success).toBe(false);
  expect(Scope.options).toEqual(['internal', 'external']);
  expect(Status.options).toEqual(['active', 'archived']);
});
it('COMM-B04 a patch carries a positive revision and may change the status; an action body is the revision alone', () => {
  expect(CommitteePatch.safeParse({ name: 'x' }).success).toBe(false);
  expect(CommitteePatch.safeParse({ revision: 0 }).success).toBe(false);
  expect(CommitteePatch.parse({ revision: 2, status: 'archived' })).toEqual({
    revision: 2,
    status: 'archived',
  });
  expect(CommitteePatch.safeParse({ revision: 2, name: '' }).success).toBe(false);
  expect(CommitteePatch.safeParse({ revision: 2, deletedAt: null }).success).toBe(false);
  expect(Revision.safeParse({ revision: 1 }).success).toBe(true);
  expect(Revision.safeParse({ revision: 1, status: 'archived' }).success).toBe(false);
});
it('COMM-B04 a reorder names each committee once with its revision fence, one to two hundred of them', () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, index) => ({ id: uuid(index + 1), revision: 1 }));
  expect(Reorder.safeParse({ items: [] }).success).toBe(false);
  expect(Reorder.safeParse({ items: items(1) }).success).toBe(true);
  expect(Reorder.safeParse({ items: items(200) }).success).toBe(true);
  expect(Reorder.safeParse({ items: items(201) }).success).toBe(false);
  expect(Reorder.safeParse({ items: [...items(1), ...items(1)] }).success).toBe(false);
  expect(Reorder.safeParse({ items: [{ id: uuid(1) }] }).success).toBe(false);
  expect(Reorder.safeParse({ items: [{ id: uuid(1), revision: 0 }] }).success).toBe(false);
  expect(Reorder.safeParse({ items: [{ id: uuid(1), revision: 1, extra: 1 }] }).success).toBe(
    false,
  );
});
it('COMM-B02 the list query knows its views and sorts, defaults to Active by name, rejects unknown parameters and clamps the page', () => {
  expect(View.options.sort()).toEqual(
    ['all', 'active', 'archived', 'trash', 'overdue', 'today', 'open', 'completed'].sort(),
  );
  expect(Sort.options.sort()).toEqual(['default', 'name', 'status', 'open_tasks', 'manual'].sort());
  expect(CommitteeListQuery.parse({})).toEqual({
    view: 'active',
    q: '',
    scope: '',
    sort: 'default',
    limit: 50,
  });
  expect(CommitteeListQuery.safeParse({ view: 'dissolved' }).success).toBe(false);
  expect(CommitteeListQuery.safeParse({ sort: 'next_meeting' }).success).toBe(false);
  expect(CommitteeListQuery.safeParse({ scope: 'regional' }).success).toBe(false);
  expect(CommitteeListQuery.safeParse({ scope: 'external' }).success).toBe(true);
  expect(CommitteeListQuery.safeParse({ made_up: '1' }).success).toBe(false);
  expect(CommitteeListQuery.safeParse({ limit: '0' }).success).toBe(false);
  expect(CommitteeListQuery.safeParse({ limit: '201' }).success).toBe(false);
  expect(CommitteeListQuery.parse({ limit: '200' }).limit).toBe(200);
  expect(CommitteeListQuery.safeParse({ q: 'x'.repeat(501) }).success).toBe(false);
  expect(ActivityQuery.safeParse({ cursor: 'abc' }).success).toBe(true);
  expect(ActivityQuery.safeParse({ page: '2' }).success).toBe(false);
});
it('COMM-B02 COMM-B05 a committee row carries its four task figures, a calendar last-note date and ISO instants, and strips the corpus', () => {
  const row = Committee.parse({
    ...stamps,
    name: 'Finance',
    description: '',
    ownership: 'Board',
    scope: 'internal',
    status: 'active',
    createdAt: new Date('2026-09-10T07:00:00Z'),
    searchText: 'finance\nboard',
  });
  expect(row.createdAt).toBe('2026-09-10T07:00:00.000Z');
  expect(row.stats).toEqual({ open: 1, completed: 2, overdue: 0, today: 1 });
  expect(row).not.toHaveProperty('searchText');
  const base = { ...stamps, name: 'Finance', scope: 'internal', status: 'active' };
  expect(Committee.safeParse({ ...base, stats: { open: 1, completed: 2 } }).success).toBe(false);
  expect(Committee.safeParse({ ...base, lastNoteDate: '2026-09-10T07:00:00Z' }).success).toBe(
    false,
  );
  expect(Committee.parse({ ...base, lastNoteDate: '2026-09-10' }).lastNoteDate).toBe('2026-09-10');
  expect(
    CommitteeList.safeParse({
      data: [],
      meta: { counts: { active: 0 }, nextCursor: null, taskStats: stamps.stats },
    }).success,
  ).toBe(true);
  expect(
    CommitteeList.safeParse({ data: [], meta: { counts: {}, nextCursor: null } }).success,
  ).toBe(false);
});
it('COMM-B03 choices, activity entries and the embedded reference keep their shapes', () => {
  const choice = { id: uuid(1), name: 'Finance', status: 'archived', deleted: false };
  expect(CommitteeChoices.safeParse({ data: [choice] }).success).toBe(true);
  expect(CommitteeChoices.safeParse({ data: [{ ...choice, deleted: 'no' }] }).success).toBe(false);
  expect(CommitteeReference.safeParse(choice).success).toBe(true);
  expect(CommitteeReference.safeParse({ ...choice, status: 'trashed' }).success).toBe(false);
  const entry = {
    id: uuid(2),
    action: 'archive',
    entityType: 'committee',
    entityId: uuid(1),
    createdAt: new Date('2026-09-10T07:00:00Z'),
  };
  const activity = Activity.parse({ data: [entry], meta: { nextCursor: null } });
  expect(activity.data[0]?.createdAt).toBe('2026-09-10T07:00:00.000Z');
  expect(Activity.safeParse({ data: [{ ...entry, entityId: 'x' }], meta: {} }).success).toBe(false);
});
