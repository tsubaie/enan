import 'server-only';
import {
  and,
  eq,
  isNull,
  isNotNull,
  inArray,
  sql,
  desc,
  getTableColumns,
  type SQL,
} from 'drizzle-orm';
import { notes, notePeople, noteRefinements } from './schema/db';
import type { Database } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { normalize, searchCorpus } from '@/core/search/normalize';
import { searchMatch, searchRank } from '@/core/db/search';
import { restoreEntity, updateEntity, type EntityPatch } from '@/core/db/entity';
import {
  cursorColumns,
  cursorPredicate,
  filteredCounts,
  orderBy,
  type SortKey,
  type SortSpec,
} from '@/core/db/keyset';
type Filters = {
  committeeId?: string;
  view: string;
  q: string;
  type: string;
  tag: string;
  personId: string;
  from: string;
  to: string;
};
export type Dates = { today: string; weekStart: string };
// ADR 0029: SQLite's JSON functions return text, so every JSON-shaped column is parsed here and a
// timestamp read through raw SQL comes back as the milliseconds the column stores.
const parseJson = (value: string | null) => (value === null ? null : JSON.parse(value));
const asDate = (value: number | null) => (value === null ? null : new Date(value));
const jsonTrue = sql`json('true')`;
const jsonFalse = sql`json('false')`;
const participants =
  sql`(select json_group_array(json_object('id', p.id, 'name', coalesce(p.display_name, p.full_name), 'kind', p.kind) order by np.created_at, np.id) from note_people np join people p on p.id = np.person_id where np.note_id = notes.id and np.deleted_at is null and p.deleted_at is null)`.mapWith(
    parseJson,
  );
const openTasks = sql<number>`(select count(*) from tasks t where t.source_note_id = notes.id and t.deleted_at is null and t.status <> 'completed')`;
const doneTasks = sql<number>`(select count(*) from tasks t where t.source_note_id = notes.id and t.deleted_at is null and t.status = 'completed')`;
const columns = {
  ...getTableColumns(notes),
  committee:
    sql`(select json_object('id', c.id, 'name', c.name, 'status', c.status, 'deleted', case when c.deleted_at is not null then ${jsonTrue} else ${jsonFalse} end) from committees c where c.id = notes.committee_id)`.mapWith(
      parseJson,
    ),
  participants,
  openTaskCount: openTasks,
  doneTaskCount: doneTasks,
};
// The corpus search reads (ADR 0029, docs/features/search.md): the title first, then the content
// and the tags. Tags are stored as the reader typed them, so their normalised form lives here
// rather than being computed per row at query time, which SQLite cannot do.
const corpusOf = (row: {
  title: string;
  content?: string | null | undefined;
  tags?: string[] | null | undefined;
}) => searchCorpus(row.title, row.content, ...(row.tags ?? []));
const touchesCorpus = (patch: EntityPatch<typeof notes.$inferInsert>) =>
  patch.title !== undefined || patch.content !== undefined || patch.tags !== undefined;
// NOTES-B04: title, content and tags through search_text; participant names by join.
function searchPredicate(q: string) {
  const normalized = normalize(q);
  return sql`(${searchMatch(notes.searchText, normalized)} or exists (select 1 from note_people np join people p on p.id = np.person_id where np.note_id = ${notes.id} and np.deleted_at is null and p.deleted_at is null and ${searchMatch(sql`p.search_text`, normalized)}))`;
}
function base(f: Filters) {
  const predicates: SQL[] = [];
  if (f.committeeId) predicates.push(eq(notes.committeeId, f.committeeId));
  if (f.type) predicates.push(eq(notes.type, f.type));
  if (f.tag)
    predicates.push(
      sql`exists (select 1 from json_each(${notes.tags}) where lower(value) = lower(${f.tag}))`,
    );
  if (f.personId)
    predicates.push(
      sql`exists (select 1 from note_people np where np.note_id = ${notes.id} and np.person_id = ${f.personId} and np.deleted_at is null)`,
    );
  if (f.from) predicates.push(sql`${notes.noteDate} >= ${f.from}`);
  if (f.to) predicates.push(sql`${notes.noteDate} <= ${f.to}`);
  if (f.q) predicates.push(searchPredicate(f.q));
  return and(...predicates);
}
// NOTES-B02: archived notes leave every non-trash view unless the user is searching.
function viewPredicate(view: string, dates: Dates, searching: boolean) {
  if (view === 'trash') return isNotNull(notes.deletedAt);
  const predicates: SQL[] = [isNull(notes.deletedAt)];
  if (view === 'archived') predicates.push(isNotNull(notes.archivedAt));
  else if (!searching) predicates.push(isNull(notes.archivedAt));
  if (view === 'this_week')
    predicates.push(sql`${notes.noteDate} between ${dates.weekStart} and ${dates.today}`);
  if (view.startsWith('type:')) predicates.push(eq(notes.type, view.slice(5)));
  return and(...predicates);
}
const idKey: SortKey = { expr: sql`${notes.id}`, direction: 'desc' };
export function sortSpec(sort: string): SortSpec {
  const keys: Record<string, SortKey[]> = {
    title: [{ expr: sql`lower(${notes.title})`, direction: 'asc' }, idKey],
    created_at: [{ expr: sql`${notes.createdAt}`, direction: 'desc' }, idKey],
  };
  return {
    id: sort,
    keys: keys[sort] ?? [
      { expr: sql`${notes.noteDate}`, direction: 'desc' },
      { expr: sql`${notes.createdAt}`, direction: 'desc' },
      idKey,
    ],
  };
}
function viewPredicates(f: Filters, dates: Dates, views: readonly string[]) {
  return Object.fromEntries(
    views.map((view) => [view, viewPredicate(view, dates, Boolean(f.q))]),
  ) as Record<string, SQL | undefined>; // cast: built from the given view list
}
// One JSON object of per-view counts, evaluated once as an uncorrelated subquery.
function countsJson(f: Filters, dates: Dates, views: readonly string[]) {
  const predicates = viewPredicates(f, dates, views);
  const pairs = views.map((view) => sql`${view}, count(*) filter (where ${predicates[view]})`);
  return sql`(select json_object(${sql.join(pairs, sql`, `)}) from notes where ${base(f) ?? sql`1`})`.mapWith(
    parseJson,
  );
}
export async function selectNotes(
  database: Database,
  f: Filters,
  dates: Dates,
  views: readonly string[],
  spec: SortSpec,
  limit: number,
  last: (string | number)[] | null,
) {
  return database
    .select({ ...columns, counts: countsJson(f, dates, views), ...cursorColumns(spec) })
    .from(notes)
    .where(and(base(f), viewPredicate(f.view, dates, Boolean(f.q)), cursorPredicate(spec, last)))
    .orderBy(...orderBy(spec))
    .limit(limit);
}
export async function countNotes(
  database: Database,
  f: Filters,
  dates: Dates,
  views: readonly string[],
) {
  const [row] = await database
    .select(filteredCounts(viewPredicates(f, dates, views)))
    .from(notes)
    .where(base(f));
  return row ?? {};
}
export async function selectNote(database: Database, noteId: string) {
  const [row] = await database.select(columns).from(notes).where(eq(notes.id, noteId));
  return row;
}
// NOTES-B07: open tasks first by due date then title, then completed by completion desc.
export function selectNoteTasks(database: Database, noteId: string) {
  return database
    .select({
      id: sql<string>`t.id`,
      revision: sql<number>`t.revision`,
      title: sql<string>`t.title`,
      status: sql<string>`t.status`,
      priority: sql<string | null>`t.priority`,
      dueDate: sql<string | null>`t.due_date`,
      completedAt: sql`t.completed_at`.mapWith(asDate),
      ownerName: sql<
        string | null
      >`(select coalesce(p.display_name, p.full_name) from people p where p.id = t.owner_id)`,
    })
    .from(sql`tasks t`)
    .where(sql`t.source_note_id = ${noteId} and t.deleted_at is null`)
    .orderBy(
      sql`(t.status = 'completed'), t.completed_at desc nulls last, t.due_date asc nulls last, lower(t.title), t.id`,
    );
}
// NOTES-B13: one row per distinct spelling, counted over the notes that carry it; ties break on
// the lower-cased name and then on bytes, as the PostgreSQL `collate "C"` did.
export function selectTags(database: Database, includeDeleted = false) {
  return database
    .select({ tag: sql<string>`tag.value`, count: sql<number>`count(*)` })
    .from(sql`notes, json_each(notes.tags) tag`)
    .where(includeDeleted ? undefined : sql`notes.deleted_at is null`)
    .groupBy(sql`tag.value`)
    .orderBy(sql`count(*) desc, lower(tag.value), tag.value collate binary`);
}
// NOTES-B21: include trash so restoring a note cannot revive a removed tag. The immediate
// transaction the caller opened is the row lock (ADR 0029).
export function lockTaggedNotes(database: Database, tags: string[]) {
  const names = sql.join(
    tags.map((tag) => sql`lower(${tag})`),
    sql`, `,
  );
  return database
    .select()
    .from(notes)
    .where(sql`exists (select 1 from json_each(${notes.tags}) where lower(value) in (${names}))`)
    .orderBy(notes.id);
}
export async function insertNote(database: Database, input: typeof notes.$inferInsert) {
  const [row] = await database
    .insert(notes)
    .values({ ...input, searchText: corpusOf(input) })
    .returning();
  if (!row) throw new Error('Note insert failed');
  return row;
}
// Every edit of a searchable field rewrites the corpus from the row as it now stands, so a patch
// that carries only the tags still leaves the title and content findable.
export async function updateNote(
  database: Database,
  noteId: string,
  revision: number,
  patch: EntityPatch<typeof notes.$inferInsert>,
  actorId: string,
) {
  const row = await updateEntity<typeof notes.$inferSelect>(
    database,
    notes,
    noteId,
    revision,
    patch,
    actorId,
  );
  if (!row) return row;
  if (touchesCorpus(patch)) {
    row.searchText = corpusOf(row);
    await database.update(notes).set({ searchText: row.searchText }).where(eq(notes.id, noteId));
  }
  await staleRefinements(database, noteId);
  return row;
}
export function restoreNote(database: Database, noteId: string, opId: string, actorId: string) {
  return restoreEntity<typeof notes.$inferSelect>(database, notes, noteId, opId, actorId);
}
export async function activeParticipantIds(database: Database, noteId: string) {
  const rows = await database
    .select({ personId: notePeople.personId })
    .from(notePeople)
    .where(and(eq(notePeople.noteId, noteId), isNull(notePeople.deletedAt)));
  return rows.map((row) => row.personId);
}
export async function insertParticipants(
  database: Database,
  noteId: string,
  personIds: string[],
  actorId: string,
) {
  if (!personIds.length) return;
  await database
    .insert(notePeople)
    .values(personIds.map((personId) => ({ id: id(), noteId, personId, createdBy: actorId })));
}
export async function removeParticipants(
  database: Database,
  noteId: string,
  personIds: string[],
  opId: string,
) {
  if (!personIds.length) return;
  await database
    .update(notePeople)
    .set({ deletedAt: new Date(), deletedOpId: opId })
    .where(
      and(
        eq(notePeople.noteId, noteId),
        inArray(notePeople.personId, personIds),
        isNull(notePeople.deletedAt),
      ),
    );
}
// NOTES-B14: count and the five newest recent notes in one statement.
export async function selectRecent(database: Database, from: string, to: string) {
  const recent = and(
    isNull(notes.deletedAt),
    isNull(notes.archivedAt),
    sql`${notes.noteDate} between ${from} and ${to}`,
  );
  const [row] = await database
    .select({
      count: sql<number>`count(*) filter (where ${recent})`,
      // HOME-B01: the row shows when the note is dated and which committee it belongs to.
      items:
        sql`(select json_group_array(json_object('id', item.id, 'title', item.title, 'date', item.date, 'committee', item.committee)
        order by item.date desc, item.created_at desc, item.id desc)
        from (select n.id, n.title, n.note_date as date, n.created_at, c.name as committee
        from notes n left join committees c on c.id = n.committee_id and c.deleted_at is null
        where n.id in (select id from notes where ${recent})
        order by n.note_date desc, n.created_at desc, n.id desc limit 5) item)`.mapWith(parseJson),
    })
    .from(notes);
  return row ?? { count: 0, items: [] };
}

export async function pendingRefinement(database: Database, noteId: string) {
  const [row] = await database
    .select()
    .from(noteRefinements)
    .where(and(eq(noteRefinements.noteId, noteId), eq(noteRefinements.status, 'pending')));
  return row;
}
export async function insertRefinement(
  database: Database,
  value: typeof noteRefinements.$inferInsert,
) {
  await database.insert(noteRefinements).values(value);
}
export async function reviewRefinement(
  database: Database,
  jobId: string,
  status: string,
  actor: string,
  appliedTaskIds: string[] = [],
) {
  await database
    .update(noteRefinements)
    .set({
      status,
      appliedTaskIds,
      reviewedBy: actor,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(noteRefinements.jobId, jobId));
}
export async function staleRefinements(database: Database, noteId: string) {
  await database
    .update(noteRefinements)
    .set({ status: 'stale', updatedAt: new Date() })
    .where(and(eq(noteRefinements.noteId, noteId), eq(noteRefinements.status, 'pending')));
}
// Historically `select … for update`; the immediate transaction already holds the write lock
// (ADR 0029), so this is the plain read of the row the caller is about to change.
export async function lockNote(database: Database, noteId: string) {
  const [row] = await database.select().from(notes).where(eq(notes.id, noteId));
  return row;
}
// SEARCH: the workspace-wide provider (ADR 0021). It reuses NOTES-B04's own predicate, so a note
// is found globally by the same things that find it in its list -- title, content, tags and the
// names of its participants -- rather than by a narrower corpus invented here.
export async function searchNotes(database: Database, normalized: string, limit: number) {
  return database
    .select({
      id: notes.id,
      title: notes.title,
      subtitle: sql<string | null>`${notes.noteDate}`,
      rank: searchRank(notes.searchText, normalized),
    })
    .from(notes)
    .where(and(isNull(notes.deletedAt), searchPredicate(normalized)))
    .orderBy(searchRank(notes.searchText, normalized), desc(notes.noteDate))
    .limit(limit);
}
// NOTIF-B06: the titles behind a page of notifications; trashed notes are absent.
export async function selectNoteSubjects(database: Database, ids: readonly string[]) {
  if (!ids.length) return [];
  return database
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(and(inArray(notes.id, [...ids]), isNull(notes.deletedAt)));
}
