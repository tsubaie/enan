import 'server-only';
import { and, eq, isNull, isNotNull, sql, inArray, getTableColumns, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { people } from './schema/db';
import { type Database } from '@/core/db/client';
import { users } from '@/core/db/system-schema';
import { normalize, searchCorpus } from '@/core/search/normalize';
import { searchMatch, searchRank } from '@/core/db/search';
import { restoreEntity, updateEntity, type EntityPatch } from '@/core/db/entity';
import {
  cursorColumns,
  cursorPredicate,
  filteredCounts,
  orderBy,
  type SortSpec,
} from '@/core/db/keyset';

type Filters = { view: string; q: string; tag: string; organization: string };
export const nameSort: SortSpec = {
  id: 'name',
  keys: [
    { expr: sql`lower(${people.fullName})`, direction: 'asc' },
    { expr: sql`${people.id}`, direction: 'asc' },
  ],
};
// Display name expression other modules may embed (owner labels); People owns its columns.
export function personNameSql(personId: AnySQLiteColumn) {
  return sql<
    string | null
  >`(select coalesce(p.display_name, p.full_name) from people p where p.id = ${personId})`;
}
function viewPredicate(view: string) {
  const where: SQL[] = [view === 'trash' ? isNotNull(people.deletedAt) : isNull(people.deletedAt)];
  if (view === 'assignable') where.push(eq(people.isAssignable, true));
  if (view === 'internal' || view === 'external') where.push(eq(people.kind, view));
  return and(...where);
}
function facets(filters: Omit<Filters, 'view'>) {
  const where: SQL[] = [];
  if (filters.organization) where.push(eq(people.organization, filters.organization));
  // `tags` is a JSON array (ADR 0029): a facet is an element match, not an array operator.
  if (filters.tag)
    where.push(sql`exists (select 1 from json_each(${people.tags}) where value = ${filters.tag})`);
  if (filters.q) where.push(searchMatch(people.searchText, normalize(filters.q)));
  return and(...where);
}
// ADR 0029: SQLite's JSON functions return text, parsed here so the service sees the object.
const parseJson = (value: string) => JSON.parse(value);
// PEOPLE-B02: what a person's card says about them, counted over live records: the tasks they own
// that are still open, how many of those are late, and the notes they took part in.
const stats = (today: string) =>
  sql`json_object(
    'openTasks', (select count(*) from tasks t where t.owner_id = people.id
      and t.deleted_at is null and t.status <> 'completed'),
    'lateTasks', (select count(*) from tasks t where t.owner_id = people.id
      and t.deleted_at is null and t.status <> 'completed' and t.due_date < ${today}),
    'notes', (select count(distinct np.note_id) from note_people np join notes n on n.id = np.note_id
      where np.person_id = people.id and np.deleted_at is null and n.deleted_at is null)
  )`.mapWith(parseJson);
export async function selectPeople(
  database: Database,
  filters: Filters,
  limit: number,
  last: (string | number)[] | null,
  // The workspace's today, which decides what is late; the service passes it.
  today = new Date().toISOString().slice(0, 10),
) {
  return database
    .select({ ...getTableColumns(people), stats: stats(today), ...cursorColumns(nameSort) })
    .from(people)
    .where(and(facets(filters), viewPredicate(filters.view), cursorPredicate(nameSort, last)))
    .orderBy(...orderBy(nameSort))
    .limit(limit);
}
export async function countPeople<V extends string>(
  database: Database,
  filters: Omit<Filters, 'view'>,
  views: readonly V[],
) {
  const [row] = await database
    .select(
      filteredCounts(
        Object.fromEntries(views.map((view) => [view, viewPredicate(view)])) as Record<
          V,
          SQL | undefined
        >, // cast: built from the same view list
      ),
    )
    .from(people)
    .where(facets(filters));
  return row;
}
export async function selectPerson(database: Database, personId: string) {
  const [row] = await database.select().from(people).where(eq(people.id, personId));
  return row;
}
// PEOPLE-I01: a case-insensitive homonym. Both sides fold through SQLite's own lower() so the
// comparison is the one the `people_name_idx` expression index stores. Two creates of the same
// name serialize on the immediate transaction (ADR 0029), so the second sees the first here.
export async function possibleDuplicates(database: Database, name: string) {
  return database
    .select()
    .from(people)
    .where(and(isNull(people.deletedAt), eq(sql`lower(${people.fullName})`, sql`lower(${name})`)))
    .limit(20);
}
// ADR 0029: the search corpus is written with the row — full name first, then display name,
// organization, role title and email, the fields the generated column concatenated.
type SearchableKey = 'fullName' | 'displayName' | 'organization' | 'roleTitle' | 'email';
type Searchable = Pick<typeof people.$inferInsert, SearchableKey>;
const searchableKeys: readonly SearchableKey[] = [
  'fullName',
  'displayName',
  'organization',
  'roleTitle',
  'email',
];
const corpusOf = (row: Searchable) =>
  searchCorpus(row.fullName, row.displayName, row.organization, row.roleTitle, row.email);
export async function insertPerson(database: Database, input: typeof people.$inferInsert) {
  const [row] = await database
    .insert(people)
    .values({ ...input, searchText: corpusOf(input) })
    .returning();
  if (!row) throw new Error('Person insert failed');
  return row;
}
export async function updatePerson(
  database: Database,
  personId: string,
  revision: number,
  patch: EntityPatch<typeof people.$inferInsert>,
  actorId: string,
) {
  let fields = patch;
  if (searchableKeys.some((key) => patch[key] !== undefined)) {
    const [current] = await database
      .select({
        fullName: people.fullName,
        displayName: people.displayName,
        organization: people.organization,
        roleTitle: people.roleTitle,
        email: people.email,
      })
      .from(people)
      .where(eq(people.id, personId));
    // A patch key that is present but undefined means "unchanged", so it must not shadow the row.
    const value = <K extends SearchableKey>(key: K) =>
      patch[key] === undefined ? current?.[key] : patch[key];
    if (current)
      fields = {
        ...patch,
        searchText: searchCorpus(
          patch.fullName ?? current.fullName,
          value('displayName'),
          value('organization'),
          value('roleTitle'),
          value('email'),
        ),
      };
  }
  return updateEntity<typeof people.$inferSelect>(
    database,
    people,
    personId,
    revision,
    fields,
    actorId,
  );
}
export function restorePerson(database: Database, personId: string, opId: string, actorId: string) {
  return restoreEntity<typeof people.$inferSelect>(database, people, personId, opId, actorId);
}

// PEOPLE-B10: one row per distinct tag spelling over people not in the trash, most used first, for
// the record's tag picker; the same shape the notes picker reads.
export function selectTags(database: Database) {
  return database
    .select({ tag: sql<string>`tag.value`, count: sql<number>`count(*)` })
    .from(sql`people, json_each(people.tags) tag`)
    .where(sql`people.deleted_at is null`)
    .groupBy(sql`tag.value`)
    .orderBy(sql`count(*) desc, lower(tag.value), tag.value collate binary`);
}
export function selectAiPeople(database: Database) {
  return database
    .select({ id: people.id, name: people.fullName, isAssignable: people.isAssignable })
    .from(people)
    .where(isNull(people.deletedAt));
}
// SEARCH: the workspace-wide provider (ADR 0021). Visibility is the list's own — a person in
// trash is not reachable here either (SEARCH-B05).
export async function searchPeople(database: Database, normalized: string, limit: number) {
  const name = sql<string>`coalesce(${people.displayName}, ${people.fullName})`;
  return database
    .select({
      id: people.id,
      title: name,
      subtitle: people.organization,
      rank: searchRank(people.searchText, normalized),
    })
    .from(people)
    .where(and(isNull(people.deletedAt), searchMatch(people.searchText, normalized)))
    .orderBy(searchRank(people.searchText, normalized), sql`lower(${name})`)
    .limit(limit);
}
// ACCT-B05: the directory record linked to a login (ADR 0011). One row or none — `people.user_id`
// is unique — and it is read by user id because that is what the account knows about itself.
export async function selectPersonForUser(database: Database, userId: string) {
  const [row] = await database
    .select({
      id: people.id,
      fullName: people.fullName,
      organization: people.organization,
      roleTitle: people.roleTitle,
    })
    .from(people)
    .where(and(eq(people.userId, userId), isNull(people.deletedAt)));
  return row ?? null;
}
// NOTIF-B04: the accounts behind a set of directory records (ADR 0011). A person with no login —
// every external person — contributes nothing, which is how they never accumulate a feed.
export async function selectUserIdsForPeople(database: Database, personIds: readonly string[]) {
  if (!personIds.length) return [];
  const rows = await database
    .select({ userId: people.userId })
    .from(people)
    .where(and(inArray(people.id, [...personIds]), isNull(people.deletedAt)));
  return rows.flatMap((row) => (row.userId ? [row.userId] : []));
}
// PEOPLE-B13: the active login whose address an internal record carries and that no directory
// record holds yet, live or trashed (`people.user_id` is unique across both).
export async function selectUnlinkedUserByEmail(database: Database, email: string) {
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.email, email.trim().toLowerCase()),
        eq(users.isActive, true),
        isNull(users.deletedAt),
        sql`not exists (select 1 from people p where p.user_id = ${users.id})`,
      ),
    );
  return rows[0]?.id ?? null;
}
// PEOPLE-B13: a new login takes the one live internal record that carries its address and is not
// linked yet. Two such records is an ambiguity a person resolves, so nothing is linked.
export async function linkUnlinkedPerson(database: Database, userId: string, email: string) {
  const match = and(
    sql`lower(${people.email}) = ${email.trim().toLowerCase()}`,
    eq(people.kind, 'internal'),
    isNull(people.userId),
    isNull(people.deletedAt),
  );
  const candidates = await database.select({ id: people.id }).from(people).where(match).limit(2);
  const [only] = candidates;
  if (candidates.length !== 1 || !only) return null;
  await database
    .update(people)
    .set({ userId })
    .where(and(eq(people.id, only.id), match));
  return only.id;
}
