import 'server-only';
import {
  and,
  eq,
  gte,
  isNull,
  isNotNull,
  sql,
  asc,
  inArray,
  ne,
  getTableColumns,
  type SQL,
} from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { embeddedJson, jsonRows as embeddedRows } from '@/core/db/json';
import { tasks, taskCompletions, taskCompletionItems } from './schema/db';
import type { Database } from '@/core/db/client';
import { normalize, searchCorpus } from '@/core/search/normalize';
import { searchMatch, searchRank } from '@/core/db/search';
import { updateEntity, type EntityPatch } from '@/core/db/entity';
import {
  cursorColumns,
  cursorPredicate,
  filteredCounts,
  orderBy,
  type SortKey,
  type SortSpec,
} from '@/core/db/keyset';
export type NameOf = (personId: AnySQLiteColumn) => SQL<string | null>;
type Filters = {
  committeeId?: string;
  view: string;
  q: string;
  ownerId: string;
  priority: string;
  dueFrom: string;
  dueTo: string;
  due: string;
  hasSubtasks: string;
  sourceNoteId: string;
  hasSourceNote: string;
  parentId?: string | undefined;
  includeSubtasks?: string | undefined;
};
// SQLite's JSON functions return text, and its timestamps are epoch milliseconds (ADR 0029):
// embedded documents are parsed here so rows keep the shape the Postgres `json_build_object`
// columns had, with instants as ISO strings and flags as booleans.
const isoOrNull = (value: number | null) => (value === null ? null : new Date(value).toISOString());
const children = sql<number>`(select count(*) from tasks c where c.parent_id = tasks.id and c.deleted_at is null)`;
const completed = sql<number>`(select count(*) from tasks c where c.parent_id = tasks.id and c.deleted_at is null and c.status = 'completed')`;
type SourceNoteRow = {
  id: string;
  title: string;
  deletedAt: number | null;
  archivedAt: number | null;
};
type CommitteeRow = { id: string; name: string; status: string; deleted: number };
const sourceNote = embeddedJson(
  sql`(select json_object('id', n.id, 'title', n.title, 'deletedAt', n.deleted_at, 'archivedAt', n.archived_at) from notes n where n.id = tasks.source_note_id)`,
  (note: SourceNoteRow) => ({
    ...note,
    deletedAt: isoOrNull(note.deletedAt),
    archivedAt: isoOrNull(note.archivedAt),
  }),
);
const committee = embeddedJson(
  sql`(select json_object('id', c.id, 'name', c.name, 'status', c.status, 'deleted', c.deleted_at is not null) from committees c where c.id = tasks.committee_id)`,
  (row: CommitteeRow) => ({ ...row, deleted: row.deleted === 1 }),
);
const columns = (ownerName: NameOf) => ({
  ...getTableColumns(tasks),
  committee,
  subtaskCount: children,
  completedSubtaskCount: completed,
  ownerName: ownerName(tasks.ownerId),
  sourceNote,
});
function noteFilters(f: Filters) {
  const predicates: SQL[] = [];
  if (f.committeeId) predicates.push(eq(tasks.committeeId, f.committeeId));
  if (f.sourceNoteId) predicates.push(eq(tasks.sourceNoteId, f.sourceNoteId));
  if (f.hasSourceNote)
    predicates.push(
      f.hasSourceNote === 'true' ? isNotNull(tasks.sourceNoteId) : isNull(tasks.sourceNoteId),
    );
  return predicates;
}
function base(f: Filters) {
  const predicates: SQL[] = noteFilters(f);
  if (f.parentId) predicates.push(eq(tasks.parentId, f.parentId));
  else if (f.includeSubtasks !== 'true') predicates.push(isNull(tasks.parentId));
  if (f.ownerId) predicates.push(eq(tasks.ownerId, f.ownerId));
  if (f.priority) predicates.push(eq(tasks.priority, f.priority));
  if (f.dueFrom) predicates.push(sql`${tasks.dueDate} >= ${f.dueFrom}`);
  if (f.dueTo) predicates.push(sql`${tasks.dueDate} <= ${f.dueTo}`);
  if (f.due) predicates.push(eq(tasks.dueDate, f.due));
  if (f.hasSubtasks)
    predicates.push(f.hasSubtasks === 'true' ? sql`${children} > 0` : sql`${children} = 0`);
  if (f.q) predicates.push(searchMatch(tasks.searchText, normalize(f.q)));
  return and(...predicates);
}
// Due dates are calendar days stored as `YYYY-MM-DD` text, so they compare as strings; the
// completed cut-off is an instant and compares against the millisecond column as a Date.
function viewPredicate(view: string, today: string, week: string, cutoff: string) {
  if (view === 'trash') return isNotNull(tasks.deletedAt);
  const predicates = [isNull(tasks.deletedAt)];
  if (view === 'completed')
    predicates.push(eq(tasks.status, 'completed'), gte(tasks.completedAt, new Date(cutoff)));
  else predicates.push(ne(tasks.status, 'completed'));
  const status = { inbox: 'inbox', next: 'next_action', waiting: 'waiting_on', someday: 'someday' }[
    view
  ];
  if (status) predicates.push(eq(tasks.status, status));
  if (view === 'today') predicates.push(sql`${tasks.dueDate} <= ${today}`);
  if (view === 'overdue') predicates.push(sql`${tasks.dueDate} < ${today}`);
  if (view === 'upcoming')
    predicates.push(sql`${tasks.dueDate} > ${today} and ${tasks.dueDate} <= ${week}`);
  return and(...predicates);
}
// Sort keys are total and non-null so keyset cursors continue exactly (TASKS-B07). Timestamps
// are already integers, so they are their own cursor value.
const priorityRank = sql`case ${tasks.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
const dueKey = sql`coalesce(${tasks.dueDate}, '9999-12-31')`;
const idKey: SortKey = { expr: sql`${tasks.id}`, direction: 'desc' };
export function sortSpec(sort: string, today: string, week: string): SortSpec {
  const band = sql`case when ${tasks.status} = 'completed' then 5 when ${tasks.dueDate} < ${today} then 0 when ${tasks.dueDate} = ${today} then 1 when ${tasks.dueDate} <= ${week} then 2 when ${tasks.dueDate} is not null then 3 else 4 end`;
  const keys: Record<string, SortKey[]> = {
    title: [{ expr: sql`lower(${tasks.title})`, direction: 'asc' }, idKey],
    priority: [{ expr: priorityRank, direction: 'desc' }, idKey],
    created_at: [{ expr: sql`${tasks.createdAt}`, direction: 'desc' }, idKey],
    updated_at: [{ expr: sql`${tasks.updatedAt}`, direction: 'desc' }, idKey],
    due_date: [{ expr: dueKey, direction: 'asc' }, idKey],
  };
  return {
    id: sort,
    keys: keys[sort] ?? [
      { expr: band, direction: 'asc' },
      { expr: dueKey, direction: 'asc' },
      { expr: priorityRank, direction: 'desc' },
      { expr: sql`${tasks.createdAt}`, direction: 'desc' },
      idKey,
    ],
  };
}
export async function selectTasks(
  database: Database,
  f: Filters,
  dates: string[],
  spec: SortSpec,
  limit: number,
  last: (string | number)[] | null,
  ownerName: NameOf,
) {
  const [today = '', week = '', cutoff = ''] = dates;
  return database
    .select({ ...columns(ownerName), ...cursorColumns(spec) })
    .from(tasks)
    .where(and(base(f), viewPredicate(f.view, today, week, cutoff), cursorPredicate(spec, last)))
    .orderBy(...orderBy(spec))
    .limit(limit);
}
export async function countTasks<V extends string>(
  database: Database,
  f: Filters,
  views: readonly V[],
  dates: string[],
) {
  const [today = '', week = '', cutoff = ''] = dates;
  const predicates = Object.fromEntries(
    views.map((view) => [view, viewPredicate(view, today, week, cutoff)]),
  ) as Record<V, SQL | undefined>; // cast: built from the same view list
  const [row] = await database
    .select(filteredCounts(predicates))
    .from(tasks)
    .where(base({ ...f, includeSubtasks: 'false', parentId: undefined }));
  return row;
}
export async function selectTask(database: Database, taskId: string, ownerName: NameOf) {
  const [row] = await database.select(columns(ownerName)).from(tasks).where(eq(tasks.id, taskId));
  return row;
}
export function selectChildren(
  database: Database,
  parentId: string,
  ownerName: NameOf,
  deleted = false,
) {
  return database
    .select(columns(ownerName))
    .from(tasks)
    .where(and(eq(tasks.parentId, parentId), deleted ? undefined : isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.sortOrder));
}
// The next free position under a parent: one past the highest any row there ever held, trashed
// rows included, so a restore or a move never lands on a position a live sibling occupies.
export async function nextOrder(database: Database, parentId: string | null) {
  const [row] = await database
    .select({ next: sql<number>`coalesce(max(${tasks.sortOrder}),-1)+1` })
    .from(tasks)
    .where(parentId ? eq(tasks.parentId, parentId) : isNull(tasks.parentId));
  return row?.next ?? 0;
}
// ADR 0029: the search corpus is written with the row. Title first, then the description, the
// same fields the generated column concatenated.
export async function insertTask(database: Database, input: typeof tasks.$inferInsert) {
  const [row] = await database
    .insert(tasks)
    .values({ ...input, searchText: searchCorpus(input.title, input.description) })
    .returning();
  if (!row) throw new Error('Task insert failed');
  return row;
}
// The corpus follows a title or description change. A patch key that is present but undefined
// means "unchanged", so it must not shadow the stored value.
async function corpusAfter(database: Database, taskId: string, patch: Patch) {
  if (patch.title === undefined && patch.description === undefined) return {};
  const [row] = await database
    .select({ title: tasks.title, description: tasks.description })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!row) return {};
  const description = patch.description === undefined ? row.description : patch.description;
  return { searchText: searchCorpus(patch.title ?? row.title, description) };
}
type Patch = EntityPatch<typeof tasks.$inferInsert>;
export async function updateTask(
  database: Database,
  taskId: string,
  revision: number,
  patch: Patch,
  actorId: string,
) {
  const set = { ...patch, ...(await corpusAfter(database, taskId, patch)) };
  return updateEntity<typeof tasks.$inferSelect>(database, tasks, taskId, revision, set, actorId);
}
// TASKS-I05: `tasks_active_order_idx` is unique on (parent, sort_order) among live rows and SQLite
// checks it row by row, nothing deferred to commit, so a reorder that swaps two siblings would
// collide halfway. Every sibling first takes a distinct negative position (none is ever negative
// otherwise, so none is taken) and then its final one: two statements, one revision bump.
function positionCase(orderedIds: string[], position: (index: number) => number) {
  return sql`case ${tasks.id} ${sql.join(
    orderedIds.map((value, index) => sql`when ${value} then ${position(index)}`),
    sql` `,
  )} end`;
}
export async function reorderTasks(database: Database, orderedIds: string[], actorId: string) {
  const affected = inArray(tasks.id, orderedIds);
  await database
    .update(tasks)
    .set({ sortOrder: positionCase(orderedIds, (index) => -(index + 1)) })
    .where(affected);
  await database
    .update(tasks)
    .set({
      sortOrder: positionCase(orderedIds, (index) => index),
      updatedBy: actorId,
      updatedAt: new Date(),
      revision: sql`${tasks.revision}+1`,
    })
    .where(affected);
}
// Embedded rows of a Home section, built in the database as a JSON array and parsed back; the
// page validates each shape against its own schema.
const jsonRows = (query: SQL) => embeddedRows(sql`coalesce((${query}), '[]')`);
// HOME-B10: no active person holds it; an owner in the trash counts as none.
const unowned = sql`(${tasks.ownerId} is null or ${tasks.ownerId} not in (select id from people where deleted_at is null))`;
export async function selectHomeSummary(database: Database, today: string) {
  const active = and(
    isNull(tasks.deletedAt),
    isNull(tasks.parentId),
    ne(tasks.status, 'completed'),
  );
  const predicates = {
    overdue: and(active, sql`${tasks.dueDate} < ${today}`),
    today: and(active, eq(tasks.dueDate, today)),
    waiting: and(active, eq(tasks.status, 'waiting_on')),
  };
  const columns: Record<string, SQL> = {};
  for (const [key, predicate] of Object.entries(predicates)) {
    columns[key + 'Count'] = sql`count(*) filter (where ${predicate})`;
    // HOME-B01: rows carry the facts the principal triages on, so the page never re-queries.
    columns[key + 'Items'] = jsonRows(
      sql`select json_group_array(json_object('id', item.id, 'title', item.title, 'revision', item.revision,
        'date', item.date, 'owner', item.owner, 'committee', item.committee))
        from (select t.id, t.title, t.revision, t.due_date as date,
        p.full_name as owner, c.name as committee
        from tasks t left join people p on p.id = t.owner_id and p.deleted_at is null
        left join committees c on c.id = t.committee_id and c.deleted_at is null
        where t.id in (select id from tasks where ${predicate})
        order by t.due_date asc nulls last, t.id limit 5) item`,
    );
  }
  // HOME-B09: how much of the overdue pile is a month or more past due. A total says how much is
  // late; this says whether it is a backlog or a crisis.
  columns['overdueStale'] =
    sql`count(*) filter (where ${predicates.overdue} and ${tasks.dueDate} < date(${today}, '-30 days'))`;
  // HOME-B14: the week ahead, one row per calendar day from today, each with how much top-level
  // open work falls due on it. A day with nothing due is still a day, so the series drives the
  // rows and the count joins to it rather than the other way round.
  columns['weekDays'] = jsonRows(
    sql`with recursive days(d) as (select date(${today}) union all select date(d, '+1 day') from days where d < date(${today}, '+6 days'))
      select json_group_array(json_object('date', d, 'count', count) order by d) from (select d,
      (select count(*) from tasks where ${active} and ${tasks.dueDate} = d) as count from days) item`,
  );
  // HOME-B10: waiting is a chase list, so it aggregates by the person holding the work rather than
  // listing each task. One row per person, the people holding the most first.
  // Work waiting on nobody is still waiting: it is counted with the rest and reported as one
  // further row, with the earliest due date among it, rather than dropped for having no owner. An
  // owner in the trash keeps the task (TASKS-I06) but holds nothing the reader can chase.
  columns['waitingUnowned'] = sql`count(*) filter (where ${predicates.waiting} and ${unowned})`;
  columns['waitingUnownedDate'] =
    sql`min(${tasks.dueDate}) filter (where ${predicates.waiting} and ${unowned})`;
  columns['waitingUnownedLate'] =
    sql`count(*) filter (where ${predicates.waiting} and ${unowned} and ${tasks.dueDate} < ${today})`;
  columns['waitingPeople'] = jsonRows(
    sql`select json_group_array(json_object('id', item.id, 'title', item.title, 'count', item.count,
      'date', item.date, 'overdue', item.overdue))
      from (select p.id, p.full_name as title, count(*) as count,
      min(t.due_date) as date, count(*) filter (where t.due_date < ${today}) as overdue
      from tasks t join people p on p.id = t.owner_id and p.deleted_at is null
      where t.id in (select id from tasks where ${predicates.waiting})
      group by p.id, p.full_name order by count(*) desc, lower(p.full_name), p.id limit 5) item`,
  );
  const [row] = await database.select(columns).from(tasks);
  return row ?? {};
}
// SEARCH: the workspace-wide provider (ADR 0021). Subtasks are included — a subtask is a record
// the reader can open — and the committee is the line that tells two similar titles apart.
export async function searchTasks(database: Database, normalized: string, limit: number) {
  const committeeName = sql<
    string | null
  >`(select c.name from committees c where c.id = ${tasks.committeeId} and c.deleted_at is null)`;
  return database
    .select({
      id: tasks.id,
      title: tasks.title,
      subtitle: committeeName,
      rank: searchRank(tasks.searchText, normalized),
    })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), searchMatch(tasks.searchText, normalized)))
    .orderBy(
      searchRank(tasks.searchText, normalized),
      sql`${tasks.dueDate} nulls last`,
      tasks.title,
    )
    .limit(limit);
}
// NOTIF-B06: the titles behind a page of notifications. Trashed tasks are absent, which is what
// drops their lines from the feed rather than leaving a link to nothing.
export async function selectTaskSubjects(database: Database, ids: readonly string[]) {
  if (!ids.length) return [];
  return database
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(inArray(tasks.id, [...ids]), isNull(tasks.deletedAt)));
}
// NOTIF-B04: open tasks due on `day` whose owner is a live person with an account, with that account.
export function selectOwnedDueOn(database: Database, day: string) {
  return database.all<{ id: string; userId: string }>(sql`select t.id, p.user_id as userId from tasks t join people p
    on p.id = t.owner_id and p.deleted_at is null and p.user_id is not null where t.due_date = ${day} and t.deleted_at is null and t.status <> 'completed'`);
}
// TASKS-B02 completion operations. Two Undos of the same completion serialize on the immediate
// transaction (ADR 0029), so the second reads the first's result.
export async function insertCompletion(
  database: Database,
  values: typeof taskCompletions.$inferInsert,
) {
  const [row] = await database.insert(taskCompletions).values(values).returning();
  if (!row) throw new Error('Completion insert failed');
  return row;
}
export async function insertCompletionItems(
  database: Database,
  rows: (typeof taskCompletionItems.$inferInsert)[],
) {
  if (rows.length) await database.insert(taskCompletionItems).values(rows);
}
export async function selectCompletion(database: Database, completionId: string) {
  const [row] = await database
    .select()
    .from(taskCompletions)
    .where(eq(taskCompletions.id, completionId));
  return row;
}
export function selectCompletionItems(database: Database, completionId: string) {
  return database
    .select()
    .from(taskCompletionItems)
    .where(eq(taskCompletionItems.completionId, completionId))
    .orderBy(asc(taskCompletionItems.taskId));
}
export async function markCompletionUndone(database: Database, completionId: string) {
  await database
    .update(taskCompletions)
    .set({ status: 'undone', undoneAt: new Date() })
    .where(eq(taskCompletions.id, completionId));
}
