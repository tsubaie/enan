import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { countQueries } from '@/core/db/query-log';
import { writeSetting } from '@/core/db/settings-repo';
import { addDays } from '@/core/time/tasks';
import { normalize } from '@/core/search/normalize';
import { personNameSql } from '@/modules/people';
import { removeCommittee } from '@/modules/committees/service';
import { TaskListQuery, View } from '../schema/validation';
import * as repo from '../repo';
import * as service from '../service';
import { harness, workspaceToday } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
type Query = Record<string, string>;
const filters = (query: Query = {}) => TaskListQuery.parse(query);
async function dates() {
  const today = await workspaceToday();
  return [today, addDays(today, 7), addDays(today, -90)];
}
// The repo functions take the same filter object the service hands them; the page is wide enough
// to hold the whole table so a view's rows and its count can be compared directly.
async function rows(query: Query = {}, limit = 200) {
  const f = filters(query);
  return repo.selectTasks(
    db(),
    f,
    await dates(),
    repo.sortSpec(f.sort, ...((await dates()).slice(0, 2) as [string, string])),
    limit,
    null,
    personNameSql,
  );
}
async function counts(query: Query = {}) {
  return repo.countTasks(db(), filters(query), View.options, await dates());
}
const ids = (list: { id: string }[]) => list.map((row) => row.id);
// One workspace with a task in every band and status, a child, an old completion and a trashed
// row, so every view and every facet has something to include and something to leave out.
async function seed() {
  const today = await workspaceToday();
  const owner = await harness.person('Leila Haddad');
  const other = await harness.person('Omar Nasser');
  const committee = await harness.committee('Finance');
  const overdue = await harness.task('Overdue high', {
    dueDate: addDays(today, -3),
    priority: 'high',
    ownerId: owner.id,
    committeeId: committee.id,
    description: 'Needs the budget figures',
  });
  const due = await harness.task('today plain', { dueDate: today, ownerId: owner.id });
  const week = await harness.task('Week low', {
    dueDate: addDays(today, 5),
    priority: 'low',
    committeeId: committee.id,
  });
  const later = await harness.task('Later high', { dueDate: addDays(today, 20), priority: 'high' });
  const waiting = await harness.task('Waiting unowned', {
    status: 'waiting_on',
    ownerId: other.id,
  });
  const someday = await harness.task('Someday committee', {
    status: 'someday',
    committeeId: committee.id,
  });
  const next = await harness.task('Next urgent', {
    status: 'next_action',
    priority: 'urgent',
    ownerId: owner.id,
  });
  const child = await harness.task('Child of overdue', { parentId: overdue.id, dueDate: today });
  const recent = await harness.task('Completed recently');
  await harness.run((ctx) => service.completeTask(ctx, recent.id, recent.revision));
  const old = await harness.task('Completed long ago');
  await harness.run((ctx) => service.completeTask(ctx, old.id, old.revision));
  await db().run(
    sql`update tasks set completed_at = ${Date.now() - 100 * 86400000} where id = ${old.id}`,
  );
  const trashed = await harness.task('Trashed');
  await harness.run((ctx) => service.removeTask(ctx, trashed.id, trashed.revision));
  return {
    today,
    owner,
    other,
    committee,
    overdue,
    due,
    week,
    later,
    waiting,
    someday,
    next,
    child,
    recent,
    old,
    trashed,
  };
}
it('TASKS-B04 TASKS-B05 every view lists exactly as many rows as it counts under the same facets', async () => {
  const s = await seed();
  const facetSets: Query[] = [
    {},
    { priority: 'high' },
    { ownerId: s.owner.id },
    { committeeId: s.committee.id },
    { hasSubtasks: 'true' },
    { hasSubtasks: 'false' },
    { dueFrom: s.today, dueTo: addDays(s.today, 7) },
    { due: s.today },
    { q: 'high' },
    { hasSourceNote: 'false' },
  ];
  for (const facets of facetSets) {
    const counted = await counts(facets);
    for (const view of View.options) {
      const listed = await rows({ ...facets, view });
      expect([view, facets, listed.length]).toEqual([view, facets, counted?.[view]]);
    }
  }
  // The absolute figures the rail shows with no facets applied.
  expect(await counts()).toEqual({
    all: 7,
    today: 2,
    overdue: 1,
    upcoming: 1,
    next: 1,
    waiting: 1,
    inbox: 4,
    someday: 1,
    completed: 1,
    trash: 1,
  });
  // Completed within ninety days only: the older completion is history, not a view.
  expect(ids(await rows({ view: 'completed' }))).toEqual([s.recent.id]);
});
it('TASKS-B04 subtasks appear only with a parent or includeSubtasks, and counts never include them', async () => {
  const s = await seed();
  expect(ids(await rows({ view: 'all' }))).not.toContain(s.child.id);
  expect(ids(await rows({ view: 'all', includeSubtasks: 'true' }))).toContain(s.child.id);
  expect(ids(await rows({ view: 'all', parentId: s.overdue.id }))).toEqual([s.child.id]);
  // The child is due today, yet the counts of both the parent-scoped and the widened request stay
  // the top-level figures the rail shows.
  expect((await counts({ view: 'all', includeSubtasks: 'true' }))?.today).toBe(2);
  expect((await counts({ view: 'all', parentId: s.overdue.id }))?.all).toBe(7);
  const [child] = await rows({ view: 'all', parentId: s.overdue.id });
  expect(child?.subtaskCount).toBe(0);
  const parent = (await rows({ view: 'all' })).find((row) => row.id === s.overdue.id);
  expect(parent).toMatchObject({ subtaskCount: 1, completedSubtaskCount: 0 });
});
it('TASKS-B07 the default order walks the bands, then due date, then priority, with undated work last', async () => {
  const s = await seed();
  expect(ids(await rows({ view: 'all', sort: 'default' }))).toEqual([
    s.overdue.id,
    s.due.id,
    s.week.id,
    s.later.id,
    // No date: urgent first, then the rest newest first.
    s.next.id,
    s.someday.id,
    s.waiting.id,
  ]);
});
it('TASKS-B07 each explicit sort is a total tuple: nulls last on due date, rank on priority, case-folded title', async () => {
  const s = await seed();
  expect(ids(await rows({ view: 'all', sort: 'due_date' }))).toEqual([
    s.overdue.id,
    s.due.id,
    s.week.id,
    s.later.id,
    s.next.id,
    s.someday.id,
    s.waiting.id,
  ]);
  expect(ids(await rows({ view: 'all', sort: 'priority' }))).toEqual([
    s.next.id,
    // Two highs: the newer id first, the same tiebreak every tuple ends in.
    s.later.id,
    s.overdue.id,
    s.week.id,
    s.someday.id,
    s.waiting.id,
    s.due.id,
  ]);
  // "today plain" is lower-case and still sorts by its letters, not its case.
  expect(ids(await rows({ view: 'all', sort: 'title' }))).toEqual([
    s.later.id,
    s.next.id,
    s.overdue.id,
    s.someday.id,
    s.due.id,
    s.waiting.id,
    s.week.id,
  ]);
  expect(ids(await rows({ view: 'all', sort: 'created_at' }))).toEqual([
    s.next.id,
    s.someday.id,
    s.waiting.id,
    s.later.id,
    s.week.id,
    s.due.id,
    s.overdue.id,
  ]);
});
it('TASKS-B07 a cursor continues exactly across an insert: a row behind it is skipped, a row ahead is reached', async () => {
  const s = await seed();
  const page = (query: Query) =>
    harness.run((ctx) => service.listTasks(ctx, TaskListQuery.parse(query)));
  const first = await page({ view: 'all', sort: 'title', limit: '3' });
  expect(ids(first.data)).toEqual([s.later.id, s.next.id, s.overdue.id]);
  expect(first.meta.nextCursor).not.toBeNull();
  // Between the pages two rows arrive: one that sorts before the boundary and one after it.
  const behind = await harness.task('Aardvark arrives late');
  const ahead = await harness.task('Zebra arrives late');
  const second = await page({
    view: 'all',
    sort: 'title',
    limit: '3',
    cursor: first.meta.nextCursor ?? '',
  });
  expect(ids(second.data)).toEqual([s.someday.id, s.due.id, s.waiting.id]);
  const third = await page({
    view: 'all',
    sort: 'title',
    limit: '3',
    cursor: second.meta.nextCursor ?? '',
  });
  expect(ids(third.data)).toEqual([s.week.id, ahead.id]);
  expect(third.meta.nextCursor).toBeNull();
  const seen = [...first.data, ...second.data, ...third.data].map((row) => row.id);
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).not.toContain(behind.id);
});
it('TASKS-B07 TASKS-B05 a cursor is refused when the sort, the view or a facet differs from the request it came from', async () => {
  await seed();
  const page = (query: Query) =>
    harness.run((ctx) => service.listTasks(ctx, TaskListQuery.parse(query)));
  const first = await page({ view: 'all', sort: 'title', limit: '1', priority: 'high' });
  const cursor = first.meta.nextCursor ?? '';
  expect(cursor).not.toBe('');
  await expect(
    page({ view: 'all', sort: 'title', priority: 'high', cursor }),
  ).resolves.toBeTruthy();
  for (const changed of [
    { view: 'all', sort: 'due_date', priority: 'high' },
    { view: 'inbox', sort: 'title', priority: 'high' },
    { view: 'all', sort: 'title', priority: '' },
    { view: 'all', sort: 'title', priority: 'high', q: 'x' },
  ])
    await expect(page({ ...changed, cursor })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { fieldErrors: { cursor: ['cursor_mismatch'] } },
    });
});
it("TASKS-B10 TASKS-A08 the owner facet is what a person's Context tab reads: their tasks, named, and counted", async () => {
  const s = await seed();
  const listed = await rows({ view: 'all', ownerId: s.owner.id, sort: 'title' });
  expect(ids(listed)).toEqual([s.next.id, s.overdue.id, s.due.id]);
  expect(listed.every((row) => row.ownerName === 'Leila Haddad')).toBe(true);
  expect((await counts({ ownerId: s.owner.id }))?.all).toBe(3);
  expect(ids(await rows({ view: 'all', ownerId: s.other.id }))).toEqual([s.waiting.id]);
  // An owner's display name, when set, is the name the row carries.
  const [unowned] = await rows({ view: 'all', ownerId: s.other.id });
  expect(unowned?.ownerName).toBe('Omar Nasser');
  expect((await rows({ view: 'all', q: 'Later' }))[0]?.ownerName).toBeNull();
});
it('TASKS-B06 search folds Arabic forms, case and compatibility characters on both corpus and query', async () => {
  const diacritics = await harness.task('الإِعْدَاد للاجتماع');
  const maqsura = await harness.task('زيارة المستشفى');
  const budget = await harness.task('Budget review', { description: 'Needs the FIGURES' });
  await harness.task('Unrelated');
  expect(ids(await rows({ q: 'اعداد' }))).toEqual([diacritics.id]);
  expect(ids(await rows({ q: 'الاعداد' }))).toEqual([diacritics.id]);
  expect(ids(await rows({ q: 'المستشفي' }))).toEqual([maqsura.id]);
  // The full-width Latin of a compatibility form folds to the same corpus (NFKC).
  expect(ids(await rows({ q: 'ＢＵＤＧＥＴ' }))).toEqual([budget.id]);
  expect(ids(await rows({ q: 'figures' }))).toEqual([budget.id]);
  expect((await counts({ q: 'اعداد' }))?.all).toBe(1);
  expect((await counts({ q: 'nothing here' }))?.all).toBe(0);
  // The corpus itself is stored normalised, so the query normaliser is the only one needed.
  const [stored] = await db().all<{ search_text: string }>(
    sql`select search_text from tasks where id = ${diacritics.id}`,
  );
  expect(stored?.search_text.split('\n')[0]).toBe(normalize('الإِعْدَاد للاجتماع'));
});
it('TASKS-B11 TASKS-I06 every list and lookup filters deleted rows unless the caller asks for them', async () => {
  const s = await seed();
  expect(ids(await rows({ view: 'trash' }))).toEqual([s.trashed.id]);
  for (const view of View.options.filter((view) => view !== 'trash'))
    expect(ids(await rows({ view }))).not.toContain(s.trashed.id);
  // The row lookup returns the deleted row so the service can decide; the service refuses it.
  expect((await repo.selectTask(db(), s.trashed.id, personNameSql))?.deletedAt).not.toBeNull();
  await expect(harness.run((ctx) => service.getTask(ctx, s.trashed.id))).rejects.toMatchObject({
    code: 'not_found',
  });
  expect((await harness.run((ctx) => service.getTask(ctx, s.trashed.id, true))).id).toBe(
    s.trashed.id,
  );
  // The children listing, the search provider and the notification subjects all drop trashed rows.
  const removal = await harness.run((ctx) => service.removeTask(ctx, s.child.id, s.child.revision));
  expect(await repo.selectChildren(db(), s.overdue.id, personNameSql)).toHaveLength(0);
  expect(
    (await repo.selectChildren(db(), s.overdue.id, personNameSql, true)).map(
      (row) => row.deletedOpId,
    ),
  ).toEqual([removal.opId]);
  expect(ids(await repo.searchTasks(db(), normalize('trashed'), 5))).toEqual([]);
  expect(ids(await repo.selectTaskSubjects(db(), [s.trashed.id, s.due.id]))).toEqual([s.due.id]);
});
it('TASKS-I05 the next free position counts trashed siblings so a restore never lands on a live one', async () => {
  const parent = await harness.task('Parent');
  await harness.task('One', { parentId: parent.id });
  await harness.task('Two', { parentId: parent.id });
  const three = await harness.task('Three', { parentId: parent.id });
  expect(await repo.nextOrder(db(), parent.id)).toBe(3);
  await harness.run((ctx) => service.removeTask(ctx, three.id, three.revision));
  expect(await repo.nextOrder(db(), parent.id)).toBe(3);
  expect(await repo.nextOrder(db(), null)).toBe(1);
});
it("COMM-B03 COMM-I03 TASKS-I06 a task carries its committee as an embedded reference that survives the committee's deletion", async () => {
  const s = await seed();
  const before = (await rows({ view: 'all', committeeId: s.committee.id, sort: 'title' })).map(
    (row) => row.committee,
  );
  expect(before).toHaveLength(3);
  expect(before[0]).toEqual({
    id: s.committee.id,
    name: 'Finance',
    status: 'active',
    deleted: false,
  });
  await harness.run((ctx) => removeCommittee(ctx, s.committee.id, 1));
  const after = await rows({ view: 'all', committeeId: s.committee.id });
  expect(after).toHaveLength(3);
  expect(after.every((row) => row.committeeId === s.committee.id)).toBe(true);
  expect(after[0]?.committee).toMatchObject({ id: s.committee.id, deleted: true });
});
it('TASKS-B04 TASKS-B07 the list and the detail golden paths stay inside the six-statement budget', async () => {
  await seed();
  const listed = await countQueries(() =>
    harness.run((ctx) => service.listTasks(ctx, TaskListQuery.parse({ view: 'today' }))),
  );
  // The workspace timezone, the default view, the counts and the page: four, never more than six.
  expect(listed.queries).toBe(4);
  expect(listed.result.data).toHaveLength(2);
  const first = listed.result.data[0];
  if (!first) throw new Error('expected a row');
  const detail = await countQueries(() => harness.run((ctx) => service.getTask(ctx, first.id)));
  expect(detail.queries).toBeLessThanOrEqual(6);
  expect(detail.result.subtasks).toHaveLength(1);
});
it('TASKS-B18 view=default answers with the default view in one request, inside the statement budget', async () => {
  await seed();
  const today = await harness.run((ctx) =>
    service.listTasks(ctx, TaskListQuery.parse({ view: 'today' })),
  );
  const resolved = await countQueries(() =>
    harness.run((ctx) => service.listTasks(ctx, TaskListQuery.parse({ view: 'default' }))),
  );
  expect(resolved.queries).toBe(4);
  expect(resolved.result.meta.defaultView).toBe('today');
  expect(resolved.result.data.map((row) => row.id)).toEqual(today.data.map((row) => row.id));
  expect(resolved.result.meta.counts).toEqual(today.meta.counts);
});
it('TASKS-B18 ADMIN-B07 the default view is the one the administrator chose; Today alone falls back to Next', async () => {
  await seed();
  const actor = harness.user?.id ?? '';
  await writeSetting(db(), 'tasks.default_view', 'all', actor);
  const all = await harness.run((ctx) =>
    service.listTasks(ctx, TaskListQuery.parse({ view: 'default' })),
  );
  expect(all.meta.defaultView).toBe('all');
  expect(all.data).toHaveLength(all.meta.counts.all ?? -1);
  await writeSetting(db(), 'tasks.default_view', 'trash', actor);
  const refused = await harness.run((ctx) =>
    service.listTasks(ctx, TaskListQuery.parse({ view: 'default' })),
  );
  expect(refused.meta.defaultView).toBe('today');
});
