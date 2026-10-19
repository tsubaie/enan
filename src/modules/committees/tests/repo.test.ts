import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { writeAudit } from '@/core/db/audit-repo';
import { migrateDatabase } from '@/core/db/migrate';
import { countQueries } from '@/core/db/query-log';
import { addDays } from '@/core/time/tasks';
import { normalize } from '@/core/search/normalize';
import { createPerson } from '@/modules/people';
import { PersonCreate, personDraft } from '@/modules/people/schema/validation';
import { completeTask, removeTask } from '@/modules/tasks/service';
import { removeNote } from '@/modules/notes/service';
import { CommitteeListQuery, View } from '../schema/validation';
import * as repo from '../repo';
import * as service from '../service';
import { harness, workspaceToday } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
type Query = Record<string, string>;
const ids = (list: { id: string }[]) => list.map((row) => row.id);
// The repo takes the parsed query; the page is wide enough to hold the table so a view's rows and
// its count compare directly (the select returns one row more than the limit for the cursor).
async function rows(query: Query = {}) {
  const parsed = CommitteeListQuery.parse({ limit: '200', ...query });
  const today = await workspaceToday();
  return repo.selectCommittees(db(), parsed, today, repo.committeeSort(parsed.sort, today), null);
}
async function counts(query: Query = {}) {
  return repo.committeeCounts(db(), CommitteeListQuery.parse(query), await workspaceToday());
}
const page = (query: Query) =>
  harness.run((ctx) => service.listCommittees(ctx, CommitteeListQuery.parse(query)));
// Four bodies in two scopes, one archived and one trashed, with work in every state a card
// counts and some it must leave out: a subtask, a trashed task, a completed one.
async function seed() {
  const today = await workspaceToday();
  const finance = await harness.committee('Finance', { ownership: 'Board', description: 'Money' });
  const audit = await harness.committee('audit panel', {
    scope: 'external',
    ownership: 'Regulator',
  });
  const risk = await harness.committee('Risk', { description: 'الإِعْدَاد للمخاطر' });
  // Archived: one open task, assigned while the body was still active.
  const archived = await harness.committee('Archived body');
  await harness.task('Archived work', { committeeId: archived.id });
  await harness.run((ctx) =>
    service.patchCommittee(ctx, archived.id, { revision: 1, status: 'archived' }),
  );
  const trashed = await harness.committee('Trashed body');
  await harness.run((ctx) => service.removeCommittee(ctx, trashed.id, 1));
  // Finance: one overdue, one due today, one completed, a subtask and a trashed task.
  const overdue = await harness.task('Late', {
    committeeId: finance.id,
    dueDate: addDays(today, -2),
  });
  await harness.task('Today', { committeeId: finance.id, dueDate: today });
  const done = await harness.task('Done', { committeeId: finance.id });
  await harness.run((ctx) => completeTask(ctx, done.id, done.revision));
  await harness.task('Child', { committeeId: finance.id, parentId: overdue.id, dueDate: today });
  const gone = await harness.task('Gone', { committeeId: finance.id, dueDate: addDays(today, -9) });
  await harness.run((ctx) => removeTask(ctx, gone.id, gone.revision));
  // Audit: three open tasks, none dated. Risk: one completed task only.
  for (const title of ['A1', 'A2', 'A3']) await harness.task(title, { committeeId: audit.id });
  const riskDone = await harness.task('Risk done', { committeeId: risk.id });
  await harness.run((ctx) => completeTask(ctx, riskDone.id, riskDone.revision));
  await harness.note('Minutes', { committeeId: finance.id, noteDate: '2026-09-01' });
  await harness.note('Later minutes', { committeeId: finance.id, noteDate: '2026-09-15' });
  const dropped = await harness.note('Dropped', {
    committeeId: finance.id,
    noteDate: '2026-12-01',
  });
  await harness.run((ctx) => removeNote(ctx, dropped.id, dropped.revision));
  return { today, finance, audit, risk, archived, trashed };
}
it('COMM-B02 every view lists exactly as many rows as it counts under the scope and search facets', async () => {
  const s = await seed();
  for (const facets of [
    {},
    { scope: 'internal' },
    { scope: 'external' },
    { q: 'body' },
    { q: 'board' },
  ]) {
    const counted = await counts(facets);
    for (const view of View.options) {
      const listed = await rows({ ...facets, view });
      expect([view, facets, listed.length]).toEqual([view, facets, counted[view]]);
    }
  }
  expect(await counts()).toEqual({
    all: 4,
    active: 3,
    archived: 1,
    trash: 1,
    overdue: 1,
    today: 1,
    open: 3,
    completed: 2,
  });
  expect(ids(await rows({ view: 'overdue' }))).toEqual([s.finance.id]);
  expect(ids(await rows({ view: 'open' }))).toEqual([s.archived.id, s.finance.id, s.audit.id]);
  expect(ids(await rows({ view: 'completed' }))).toEqual([s.finance.id, s.risk.id]);
});
it("COMM-B02 COMM-B05 a card's figures count live top-level tasks only, and its last note skips trashed notes", async () => {
  const s = await seed();
  const finance = await repo.selectCommittee(db(), s.finance.id, s.today);
  expect(finance?.stats).toEqual({ open: 2, completed: 1, overdue: 1, today: 1 });
  expect(finance?.lastNoteDate).toBe('2026-09-15');
  const audit = await repo.selectCommittee(db(), s.audit.id, s.today);
  expect(audit?.stats).toEqual({ open: 3, completed: 0, overdue: 0, today: 0 });
  expect(audit?.lastNoteDate).toBeNull();
  // One statement reads the row and every figure on it.
  const read = await countQueries(() => repo.selectCommittee(db(), s.finance.id, s.today));
  expect(read.queries).toBe(1);
  // The list's summary strip adds the figures of the rows in view.
  const stats = await repo.taskStats(db(), CommitteeListQuery.parse({ view: 'active' }), s.today);
  expect(stats).toEqual({ open: 5, completed: 2, today: 1, overdue: 1 });
  const listed = await countQueries(() => page({ view: 'all' }));
  expect(listed.queries).toBeLessThanOrEqual(6);
  expect(listed.result.meta.taskStats.open).toBe(6);
});
it('COMM-B02 the sorts put internal bodies first and then order by name, open work, manual position or status', async () => {
  const s = await seed();
  // Name is case-folded: "audit panel" would otherwise sort after every capitalised name.
  expect(ids(await rows({ view: 'all', sort: 'default' }))).toEqual([
    s.archived.id,
    s.finance.id,
    s.risk.id,
    s.audit.id,
  ]);
  expect(ids(await rows({ view: 'all', sort: 'name' }))).toEqual(
    ids(await rows({ view: 'all', sort: 'default' })),
  );
  expect(ids(await rows({ view: 'all', sort: 'open_tasks' }))).toEqual([
    s.finance.id,
    s.archived.id,
    s.risk.id,
    s.audit.id,
  ]);
  expect(ids(await rows({ view: 'all', sort: 'status' }))).toEqual([
    s.finance.id,
    s.risk.id,
    s.archived.id,
    s.audit.id,
  ]);
  await harness.run((ctx) =>
    service.reorderCommittees(ctx, {
      items: [
        { id: s.risk.id, revision: 1 },
        { id: s.finance.id, revision: 1 },
        { id: s.archived.id, revision: 2 },
        { id: s.audit.id, revision: 1 },
      ],
    }),
  );
  expect(ids(await rows({ view: 'all', sort: 'manual' }))).toEqual([
    s.risk.id,
    s.finance.id,
    s.archived.id,
    s.audit.id,
  ]);
});
it('COMM-B02 a cursor continues exactly across an insert and is refused once the filters change', async () => {
  const s = await seed();
  const first = await page({ view: 'all', limit: '2' });
  expect(ids(first.data)).toEqual([s.archived.id, s.finance.id]);
  const cursor = first.meta.nextCursor ?? '';
  expect(cursor).not.toBe('');
  // One body arrives before the boundary and one after it while the reader is between pages.
  const behind = await harness.committee('Aardvark council');
  const ahead = await harness.committee('Zoning board');
  const second = await page({ view: 'all', limit: '2', cursor });
  expect(ids(second.data)).toEqual([s.risk.id, ahead.id]);
  const third = await page({ view: 'all', limit: '2', cursor: second.meta.nextCursor ?? '' });
  expect(ids(third.data)).toEqual([s.audit.id]);
  expect(third.meta.nextCursor).toBeNull();
  const seen = ids([...first.data, ...second.data, ...third.data]);
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).not.toContain(behind.id);
  for (const changed of [
    { view: 'active' },
    { view: 'all', sort: 'manual' },
    { view: 'all', scope: 'internal' },
    { view: 'all', q: 'x' },
  ])
    await expect(page({ ...changed, cursor })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { fieldErrors: { cursor: ['cursor_mismatch'] } },
    });
});
it('COMM-B02 search covers name, description and ownership with Arabic forms and case folded', async () => {
  const s = await seed();
  expect(ids(await rows({ view: 'all', q: 'FINANCE' }))).toEqual([s.finance.id]);
  expect(ids(await rows({ view: 'all', q: 'money' }))).toEqual([s.finance.id]);
  expect(ids(await rows({ view: 'all', q: 'regulator' }))).toEqual([s.audit.id]);
  expect(ids(await rows({ view: 'all', q: 'اعداد' }))).toEqual([s.risk.id]);
  expect(ids(await rows({ view: 'all', q: 'الاعداد' }))).toEqual([s.risk.id]);
  expect((await counts({ q: 'اعداد' })).all).toBe(1);
  // A renamed body is found by its new name and no longer by its old one.
  await harness.run((ctx) =>
    service.patchCommittee(ctx, s.risk.id, { revision: 1, name: 'Compliance' }),
  );
  expect(ids(await rows({ view: 'all', q: 'compliance' }))).toEqual([s.risk.id]);
  expect(ids(await rows({ view: 'all', q: 'risk' }))).toEqual([]);
  const [stored] = await db().all<{ search_text: string }>(
    sql`select search_text from committees where id = ${s.risk.id}`,
  );
  expect(stored?.search_text).toBe(
    `${normalize('Compliance')}\n${normalize('الإِعْدَاد للمخاطر')}`,
  );
});
it('COMM-I03 COMM-B02 trashed bodies appear in Trash alone; choices and workspace search leave them out', async () => {
  const s = await seed();
  expect(ids(await rows({ view: 'trash' }))).toEqual([s.trashed.id]);
  for (const view of View.options.filter((view) => view !== 'trash'))
    expect(ids(await rows({ view }))).not.toContain(s.trashed.id);
  // The picker offers active bodies, plus whichever one the record already names.
  expect(ids(await repo.selectChoices(db()))).toEqual([s.audit.id, s.finance.id, s.risk.id]);
  expect(await repo.selectChoices(db(), s.trashed.id)).toContainEqual({
    id: s.trashed.id,
    name: 'Trashed body',
    status: 'active',
    deleted: true,
  });
  expect(ids(await repo.selectChoices(db(), s.archived.id))).toContain(s.archived.id);
  // Workspace search keeps archived bodies, which ended but were not thrown away.
  expect(ids(await repo.searchCommittees(db(), normalize('body'), 5))).toEqual([s.archived.id]);
  expect((await repo.selectCommittee(db(), s.trashed.id, s.today))?.deletedAt).not.toBeNull();
  await expect(harness.run((ctx) => service.getCommittee(ctx, s.trashed.id))).rejects.toMatchObject(
    { code: 'not_found' },
  );
});
it('COMM-I01 a live name is taken case-insensitively, except by its own row, and a trashed one is free', async () => {
  const s = await seed();
  expect(await repo.duplicateName(db(), 'FINANCE')).toBe(true);
  expect(await repo.duplicateName(db(), ' finance')).toBe(false);
  expect(await repo.duplicateName(db(), 'Finance', s.finance.id)).toBe(false);
  expect(await repo.duplicateName(db(), 'Trashed body')).toBe(false);
  expect(await repo.duplicateName(db(), 'archived BODY')).toBe(true);
});
it("COMM-B03 COMM-A05 activity carries the committee's own entries and those of its tasks and notes, newest first, fifty a page", async () => {
  const s = await seed();
  const unrelated = await harness.task('Unrelated');
  const person = await harness.run((ctx) =>
    createPerson(ctx, PersonCreate.parse(personDraft('Private Person'))),
  );
  const entries = (await harness.run((ctx) => service.activity(ctx, s.finance.id))).data;
  expect(entries.some((row) => row.entityType === 'committee' && row.action === 'create')).toBe(
    true,
  );
  expect(entries.filter((row) => row.entityType === 'task').map((row) => row.action)).toContain(
    'complete',
  );
  expect(entries.filter((row) => row.entityType === 'note')).toHaveLength(4);
  expect(entries.some((row) => row.entityId === unrelated.id)).toBe(false);
  expect(entries.some((row) => row.entityId === person.data?.id)).toBe(false);
  expect(entries.every((row) => ['committee', 'task', 'note'].includes(row.entityType))).toBe(true);
  const times = entries.map((row) => new Date(row.createdAt).getTime());
  expect([...times].sort((a, b) => b - a)).toEqual(times);
  // Pad the log past one page and read it back across the cursor without a gap or a repeat.
  for (let index = 0; index < 60; index += 1)
    await writeAudit(db(), harness.user?.id ?? '', 'update', 'committee', s.finance.id, { index });
  const first = await harness.run((ctx) => service.activity(ctx, s.finance.id));
  expect(first.data).toHaveLength(50);
  expect(first.meta.nextCursor).not.toBeNull();
  const second = await harness.run((ctx) =>
    service.activity(ctx, s.finance.id, first.meta.nextCursor ?? undefined),
  );
  expect(second.meta.nextCursor).toBeNull();
  const seen = ids([...first.data, ...second.data]);
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen.length).toBe(entries.length + 60);
});
it('COMM-B06 the Home section lists active bodies carrying open top-level work, busiest first, never an archived or trashed one', async () => {
  const s = await seed();
  const trashedWork = await harness.task('Trashed work', { committeeId: s.risk.id });
  await harness.run((ctx) => removeTask(ctx, trashedWork.id, trashedWork.revision));
  const summary = await repo.selectHomeSummary(db(), s.today);
  expect(summary.count).toBe(2);
  expect(summary.items).toEqual([
    { id: s.audit.id, title: 'audit panel', count: 3, owner: 'Regulator', overdue: 0, done: 0 },
    { id: s.finance.id, title: 'Finance', count: 2, owner: 'Board', overdue: 1, done: 1 },
  ]);
  const read = await countQueries(() => repo.selectHomeSummary(db(), s.today));
  expect(read.queries).toBe(1);
  const [section] = await harness.run((ctx) => service.homeSummary(ctx, s.today));
  expect(section?.count).toBe(2);
  expect(section?.items.map((item) => item.id)).toEqual([s.audit.id, s.finance.id]);
});
