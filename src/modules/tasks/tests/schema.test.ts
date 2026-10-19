import { expect, it } from 'vitest';
import {
  BreakdownApply,
  BreakdownOutput,
  Complete,
  Group,
  Move,
  Operation,
  Priority,
  Reorder,
  Revision,
  Sort,
  Status,
  Task,
  TaskCreate,
  TaskListQuery,
  TaskPatch,
  View,
} from '../schema/validation';
const uuid = (n: number) => `01a0a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
// The schema layer proper: the closed lists, the caps, and the action payloads. The defaults and
// the band arithmetic are proven in validation.test.ts and are not repeated here.
it('TASKS-B01 TASKS-B02 the status, priority, view and sort vocabularies are closed lists', () => {
  expect(Status.options).toEqual(['inbox', 'next_action', 'waiting_on', 'someday', 'completed']);
  expect(Priority.options).toEqual(['low', 'medium', 'high', 'urgent']);
  expect(View.options.sort()).toEqual(
    [
      'all',
      'today',
      'overdue',
      'upcoming',
      'next',
      'waiting',
      'inbox',
      'someday',
      'completed',
      'trash',
    ].sort(),
  );
  expect(Sort.options.sort()).toEqual(
    ['default', 'due_date', 'priority', 'title', 'created_at', 'updated_at'].sort(),
  );
  // A create never lands on `completed`: that status is reached only through the action route.
  expect(TaskCreate.safeParse({ title: 'x', status: 'completed' }).success).toBe(false);
  expect(TaskCreate.safeParse({ title: 'x', status: 'someday' }).success).toBe(true);
  expect(TaskCreate.safeParse({ title: 'x', priority: 'critical' }).success).toBe(false);
  expect(TaskCreate.safeParse({ title: 'x', priority: null }).success).toBe(true);
});
it('TASKS-B01 the title and description caps and the identifier shapes are enforced on create', () => {
  expect(TaskCreate.safeParse({ title: 'x'.repeat(500) }).success).toBe(true);
  expect(TaskCreate.safeParse({ title: 'x'.repeat(501) }).success).toBe(false);
  expect(TaskCreate.safeParse({ title: '   ' }).success).toBe(false);
  expect(TaskCreate.safeParse({ title: 'x', description: 'd'.repeat(50000) }).success).toBe(true);
  expect(TaskCreate.safeParse({ title: 'x', description: 'd'.repeat(50001) }).success).toBe(false);
  for (const field of ['ownerId', 'committeeId', 'sourceNoteId', 'parentId']) {
    expect(TaskCreate.safeParse({ title: 'x', [field]: 'not-a-uuid' }).success).toBe(false);
    expect(TaskCreate.safeParse({ title: 'x', [field]: uuid(1) }).success).toBe(true);
    expect(TaskCreate.safeParse({ title: 'x', [field]: null }).success).toBe(true);
  }
  // The body is closed: a field the contract does not name is a validation failure, never ignored.
  expect(TaskCreate.safeParse({ title: 'x', links: [] }).success).toBe(false);
  expect(TaskCreate.safeParse({ title: 'x', unknown: 1 }).success).toBe(false);
});
it('TASKS-B12 TASKS-B02 a patch carries a positive integer revision and may name any status but keeps the body closed', () => {
  expect(TaskPatch.safeParse({ title: 'x' }).success).toBe(false);
  expect(TaskPatch.safeParse({ revision: 0, title: 'x' }).success).toBe(false);
  expect(TaskPatch.safeParse({ revision: 1.5, title: 'x' }).success).toBe(false);
  expect(TaskPatch.safeParse({ revision: 2 }).success).toBe(true);
  // The schema admits `completed` so the service can answer 422 TASKS-B02 rather than a 400.
  expect(TaskPatch.safeParse({ revision: 1, status: 'completed' }).success).toBe(true);
  expect(TaskPatch.safeParse({ revision: 1, status: 'done' }).success).toBe(false);
  expect(TaskPatch.safeParse({ revision: 1, parentId: uuid(1) }).success).toBe(false);
  // A patch field left out stays out: no default is injected into a partial update.
  expect(TaskPatch.parse({ revision: 1, priority: null })).toEqual({ revision: 1, priority: null });
});
it('TASKS-B02 TASKS-B08 the action payloads carry a revision, a force flag defaulting off, a parent or an operation id', () => {
  expect(Revision.safeParse({ revision: 3 }).success).toBe(true);
  expect(Revision.safeParse({ revision: 3, extra: true }).success).toBe(false);
  expect(Complete.parse({ revision: 3 })).toEqual({ revision: 3, force: false });
  expect(Complete.parse({ revision: 3, force: true }).force).toBe(true);
  expect(Complete.safeParse({ revision: 3, force: 'yes' }).success).toBe(false);
  expect(Operation.safeParse({ opId: uuid(7) }).success).toBe(true);
  expect(Operation.safeParse({ opId: 'op-7' }).success).toBe(false);
  expect(Move.safeParse({ revision: 1, parentId: uuid(2) }).success).toBe(true);
  expect(Move.safeParse({ revision: 1, parentId: null }).success).toBe(false);
  expect(Move.safeParse({ revision: 1 }).success).toBe(false);
});
it('TASKS-B09 a group names at least two distinct children and at most two hundred', () => {
  expect(Group.safeParse({ title: 'Pack', childIds: [uuid(1)] }).success).toBe(false);
  expect(Group.safeParse({ title: 'Pack', childIds: [uuid(1), uuid(1)] }).success).toBe(false);
  expect(Group.safeParse({ title: 'Pack', childIds: [uuid(1), uuid(2)] }).success).toBe(true);
  expect(Group.safeParse({ title: ' ', childIds: [uuid(1), uuid(2)] }).success).toBe(false);
  const many = Array.from({ length: 201 }, (_, index) => uuid(index + 1));
  expect(Group.safeParse({ title: 'Pack', childIds: many }).success).toBe(false);
  expect(Group.safeParse({ title: 'Pack', childIds: many.slice(0, 200) }).success).toBe(true);
});
it('TASKS-I05 TASKS-B12 a reorder names the parent, the whole order and a revision fence per child', () => {
  const orderedIds = [uuid(1), uuid(2)];
  const revisions = { [uuid(1)]: 1, [uuid(2)]: 4 };
  expect(Reorder.safeParse({ parentId: uuid(9), orderedIds, revisions }).success).toBe(true);
  expect(Reorder.safeParse({ parentId: null, orderedIds, revisions }).success).toBe(true);
  expect(Reorder.safeParse({ parentId: uuid(9), orderedIds }).success).toBe(false);
  expect(
    Reorder.safeParse({ parentId: uuid(9), orderedIds, revisions: { [uuid(1)]: 0 } }).success,
  ).toBe(false);
  expect(
    Reorder.safeParse({ parentId: uuid(9), orderedIds, revisions: { 'not-a-uuid': 1 } }).success,
  ).toBe(false);
  expect(
    Reorder.safeParse({ parentId: uuid(9), orderedIds: [uuid(1), uuid(1)], revisions }).success,
  ).toBe(false);
});
it('TASKS-B13 the breakdown output holds one to eight short subtasks and an apply selects distinct indexes', () => {
  const subtask = { title: 'Collect minutes', description: null, dueDate: null };
  expect(BreakdownOutput.safeParse({ subtasks: [] }).success).toBe(false);
  expect(BreakdownOutput.safeParse({ subtasks: Array(8).fill(subtask) }).success).toBe(true);
  expect(BreakdownOutput.safeParse({ subtasks: Array(9).fill(subtask) }).success).toBe(false);
  expect(
    BreakdownOutput.safeParse({ subtasks: [{ ...subtask, title: 't'.repeat(121) }] }).success,
  ).toBe(false);
  expect(BreakdownApply.safeParse({ jobId: uuid(3), indexes: [0, 7] }).success).toBe(true);
  expect(BreakdownApply.safeParse({ jobId: uuid(3), indexes: [] }).success).toBe(false);
  expect(BreakdownApply.safeParse({ jobId: uuid(3), indexes: [8] }).success).toBe(false);
  expect(BreakdownApply.safeParse({ jobId: uuid(3), indexes: [1, 1] }).success).toBe(false);
});
it('TASKS-B04 TASKS-B05 TASKS-B07 the list query rejects unknown parameters and clamps its page', () => {
  expect(TaskListQuery.parse({})).toMatchObject({ view: 'all', sort: 'default', limit: 50 });
  expect(TaskListQuery.safeParse({ view: 'made_up' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ sort: 'band' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ unknown: '1' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ limit: '0' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ limit: '201' }).success).toBe(false);
  expect(TaskListQuery.parse({ limit: '200' }).limit).toBe(200);
  // Facets are typed: a day is a calendar date, a flag is one of the three states, an id a UUID.
  expect(TaskListQuery.safeParse({ due: '2026-13-01' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ dueFrom: '2026-09-01', dueTo: '2026-09-30' }).success).toBe(
    true,
  );
  expect(TaskListQuery.safeParse({ hasSubtasks: 'maybe' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ hasSourceNote: 'true' }).success).toBe(true);
  expect(TaskListQuery.safeParse({ ownerId: 'someone' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ priority: 'urgent' }).success).toBe(true);
  expect(TaskListQuery.safeParse({ includeSubtasks: 'yes' }).success).toBe(false);
  expect(TaskListQuery.safeParse({ withTotal: 'true', q: 'x'.repeat(500) }).success).toBe(true);
  expect(TaskListQuery.safeParse({ q: 'x'.repeat(501) }).success).toBe(false);
});
it('TASKS-B03 TASKS-B16 a task row carries a nullable band and a source note whose instants are ISO strings', () => {
  const row = {
    id: uuid(1),
    revision: 1,
    title: 'Row',
    status: 'inbox',
    parentId: null,
    sortOrder: 0,
    completedAt: null,
    createdAt: new Date('2026-09-10T07:00:00Z'),
    updatedAt: '2026-09-10T07:00:00.000Z',
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    deletedOpId: null,
  };
  const parsed = Task.parse(row);
  expect(parsed.band).toBeNull();
  expect(parsed.createdAt).toBe('2026-09-10T07:00:00.000Z');
  expect(parsed.sourceNote).toBeNull();
  expect(parsed.committee).toBeNull();
  expect(Task.safeParse({ ...row, band: 'soon' }).success).toBe(false);
  expect(
    Task.safeParse({
      ...row,
      sourceNote: { id: uuid(2), title: 'Minutes', deletedAt: 1757487600000, archivedAt: null },
    }).success,
  ).toBe(false);
  expect(
    Task.parse({
      ...row,
      sourceNote: {
        id: uuid(2),
        title: 'Minutes',
        deletedAt: '2026-09-10T07:00:00.000Z',
        archivedAt: null,
      },
    }).sourceNote?.deletedAt,
  ).toBe('2026-09-10T07:00:00.000Z');
});
