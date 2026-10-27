import 'server-only';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  getTableColumns,
  type SQL,
} from 'drizzle-orm';
import type { Database } from '@/core/db/client';
import { normalize, searchCorpus } from '@/core/search/normalize';
import { searchMatch, searchRank } from '@/core/db/search';
import { updateEntity, restoreEntity, type EntityPatch } from '@/core/db/entity';
import { kpis, kpiReadings, kpiTargets, objectives } from './schema/db';
type ListQuery = {
  view: string;
  q: string;
  objectiveId: string;
  category: string;
  ownerId: string;
};
type Reading = { date: string; value: number };
type Target = { year: number; period: number; value: number };
// The window a list or a record is read through: the day the workspace is on and the earliest year
// worth fetching a target for. Every KPI is on its own cadence, so the period boundaries themselves
// are derived per row from `kpis.frequency` rather than passed in — one statement cannot carry one
// set of dates for rows that are reported monthly, quarterly and annually.
export type Window = { today: string; fromYear: number };
// A scorecard is a bounded instrument: objectives, a category per KPI, a handful of readings each.
// The list reads its candidates in one statement and ranks them in the service, because a KPI's
// status is a function of the workspace's thresholds and today's date rather than of a column
// (KPIS-B10, KPIS-B11). This is the ceiling on how many KPIs one page of that ranking considers.
export const CANDIDATE_LIMIT = 500;
// ADR 0029: SQLite's JSON functions return text; each JSON-shaped column names the shape it parses
// into. `value` and `target_value` are REAL, so they arrive as numbers with nothing to cast.
const json = <T>(query: SQL): SQL<T> =>
  query.mapWith((value: string | null): T => JSON.parse(value ?? 'null'));
const live = sql`r.deleted_at is null`;
// The first day of the period `today` falls in, read off the row's own frequency: the month, the
// quarter (the year's start moved forward by whole quarters) or the year.
const quarterMonths = (today: string) =>
  sql`((cast(strftime('%m', ${today}) as integer) - 1) / 3 * 3)`;
const periodStart = (today: string) => sql`case kpis.frequency
  when 'monthly' then date(${today}, 'start of month')
  when 'quarterly' then date(${today}, 'start of year', '+' || ${quarterMonths(today)} || ' months')
  else date(${today}, 'start of year') end`;
// The same boundary one period earlier.
const previousPeriodStart = (today: string) => sql`case kpis.frequency
  when 'monthly' then date(${today}, 'start of month', '-1 month')
  when 'quarterly' then date(${today}, 'start of year', '+' || ${quarterMonths(today)} || ' months', '-3 months')
  else date(${today}, 'start of year', '-1 year') end`;
const upTo = (today: string) => sql`r.kpi_id = kpis.id and ${live} and r.reading_date <= ${today}`;
function columns(window: Window) {
  const today = window.today;
  return {
    ...getTableColumns(kpis),
    objectiveName: sql<
      string | null
    >`(select o.name from objectives o where o.id = kpis.objective_id)`,
    objectiveOrder: sql<
      number | null
    >`(select o.sort_order from objectives o where o.id = kpis.objective_id)`,
    objectiveDeleted:
      sql`coalesce((select o.deleted_at is not null from objectives o where o.id = kpis.objective_id), 0)`.mapWith(
        Boolean,
      ),
    ownerName: sql<string | null>`(select p.full_name from people p where p.id = kpis.owner_id)`,
    current: json<Reading | null>(sql`(select json_object('date', r.reading_date, 'value', r.value)
      from kpi_readings r where ${upTo(today)} order by r.reading_date desc, r.id desc limit 1)`),
    // KPIS-B05: the last eight readings up to today, oldest first so the spark reads left to right.
    sparkline: json<
      Reading[]
    >(sql`(select json_group_array(json_object('date', s.reading_date, 'value', s.value)
      order by s.reading_date) from (select r.reading_date, r.value from kpi_readings r
      where ${upTo(today)} order by r.reading_date desc limit 8) s)`),
    // Only the quarters the status and the previous-quarter comparison can reach, newest last.
    targets: json<
      Target[]
    >(sql`(select json_group_array(json_object('year', s.year, 'period', s.period, 'value', s.target_value)
      order by s.year, s.period) from (select t.year, t.period, t.target_value from kpi_targets t
      where t.kpi_id = kpis.id and t.deleted_at is null and t.year >= ${window.fromYear}
      order by t.year, t.period limit 40) s)`),
    previousPeriodValue: sql<
      number | null
    >`(select r.value from kpi_readings r where r.kpi_id = kpis.id and ${live}
      and r.reading_date >= ${previousPeriodStart(today)}
      and r.reading_date < ${periodStart(today)}
      order by r.reading_date desc, r.id desc limit 1)`,
  };
}
// docs/features/search.md: name, category, notes.
const corpusOf = (row: {
  name: string;
  category?: string | null | undefined;
  notes?: string | null | undefined;
}) => searchCorpus(row.name, row.category, row.notes);
function base(query: ListQuery) {
  return and(
    query.q ? searchMatch(kpis.searchText, normalize(query.q)) : undefined,
    query.objectiveId === 'none'
      ? isNull(kpis.objectiveId)
      : query.objectiveId
        ? eq(kpis.objectiveId, query.objectiveId)
        : undefined,
    query.category ? eq(kpis.category, query.category) : undefined,
    query.ownerId === 'none'
      ? isNull(kpis.ownerId)
      : query.ownerId
        ? eq(kpis.ownerId, query.ownerId)
        : undefined,
  );
}
// Deleted rows come back with the rest: the service partitions them into the trash view and counts
// every view from the one result, which is what keeps the list to two statements (KPIS-B07). The
// live and the deleted rows are bounded apart, so a full trash never crowds a live KPI out.
export function selectKpis(database: Database, query: ListQuery, window: Window) {
  const order = [sql`lower(${kpis.name})`, kpis.id];
  const bounded = (state: SQL) =>
    inArray(
      kpis.id,
      database
        .select({ id: kpis.id })
        .from(kpis)
        .where(and(base(query), state))
        .orderBy(...order)
        .limit(CANDIDATE_LIMIT),
    );
  return database
    .select(columns(window))
    .from(kpis)
    .where(or(bounded(isNull(kpis.deletedAt)), bounded(isNotNull(kpis.deletedAt))))
    .orderBy(...order);
}
export async function selectKpi(database: Database, kpiId: string, window: Window) {
  const [row] = await database.select(columns(window)).from(kpis).where(eq(kpis.id, kpiId));
  return row;
}
export async function selectFacets(database: Database) {
  const categories = await database
    .select({ value: kpis.category })
    .from(kpis)
    .where(and(isNull(kpis.deletedAt), sql`${kpis.category} <> ''`))
    .groupBy(kpis.category)
    .orderBy(kpis.category);
  const named = await database
    .select({ id: objectives.id, name: objectives.name })
    .from(objectives)
    .where(isNull(objectives.deletedAt))
    .orderBy(objectives.sortOrder, objectives.id);
  return { categories: categories.map((row) => row.value), objectives: named };
}
export function selectReadings(database: Database, kpiId: string) {
  return database
    .select({
      id: kpiReadings.id,
      revision: kpiReadings.revision,
      readingDate: kpiReadings.readingDate,
      value: kpiReadings.value,
      note: kpiReadings.note,
      createdAt: kpiReadings.createdAt,
    })
    .from(kpiReadings)
    .where(and(eq(kpiReadings.kpiId, kpiId), isNull(kpiReadings.deletedAt)))
    .orderBy(sql`${kpiReadings.readingDate} desc`, sql`${kpiReadings.id} desc`)
    .limit(200);
}
export function selectTargets(database: Database, kpiId: string) {
  return database
    .select({
      id: kpiTargets.id,
      year: kpiTargets.year,
      period: kpiTargets.period,
      targetValue: kpiTargets.targetValue,
    })
    .from(kpiTargets)
    .where(and(eq(kpiTargets.kpiId, kpiId), isNull(kpiTargets.deletedAt)))
    .orderBy(kpiTargets.year, kpiTargets.period);
}
export async function insertKpi(database: Database, input: typeof kpis.$inferInsert) {
  const [row] = await database
    .insert(kpis)
    .values({
      ...input,
      searchText: corpusOf(input),
      sortOrder: sql`(select coalesce(max(sort_order), -1) + 1 from kpis)`,
    })
    .returning();
  if (!row) throw new Error('KPI insert failed');
  return row;
}
// A change to a searchable field rewrites the corpus from the row as it now stands.
export async function updateKpi(
  database: Database,
  kpiId: string,
  revision: number,
  patch: EntityPatch<typeof kpis.$inferInsert>,
  actor: string,
) {
  const row = await updateEntity<typeof kpis.$inferSelect>(
    database,
    kpis,
    kpiId,
    revision,
    patch,
    actor,
  );
  if (
    row &&
    (patch.name !== undefined || patch.category !== undefined || patch.notes !== undefined)
  ) {
    row.searchText = corpusOf(row);
    await database.update(kpis).set({ searchText: row.searchText }).where(eq(kpis.id, kpiId));
  }
  return row;
}
export function restoreKpi(database: Database, kpiId: string, opId: string, actor: string) {
  return restoreEntity<typeof kpis.$inferSelect>(database, kpis, kpiId, opId, actor);
}
// KPIS-I03: the children are hidden under the parent's operation id, so a restore of that operation
// brings back exactly the rows it hid and leaves rows deleted earlier alone.
export async function hideChildren(database: Database, kpiId: string, opId: string) {
  const stamp = { deletedAt: new Date(), deletedOpId: opId };
  await database
    .update(kpiReadings)
    .set(stamp)
    .where(and(eq(kpiReadings.kpiId, kpiId), isNull(kpiReadings.deletedAt)));
  await database
    .update(kpiTargets)
    .set(stamp)
    .where(and(eq(kpiTargets.kpiId, kpiId), isNull(kpiTargets.deletedAt)));
}
export async function revealChildren(database: Database, kpiId: string, opId: string) {
  const stamp = { deletedAt: null, deletedOpId: null };
  await database
    .update(kpiReadings)
    .set(stamp)
    .where(and(eq(kpiReadings.kpiId, kpiId), eq(kpiReadings.deletedOpId, opId)));
  await database
    .update(kpiTargets)
    .set(stamp)
    .where(and(eq(kpiTargets.kpiId, kpiId), eq(kpiTargets.deletedOpId, opId)));
}
export async function selectReadingOn(database: Database, kpiId: string, day: string) {
  const [row] = await database
    .select({ id: kpiReadings.id, revision: kpiReadings.revision, value: kpiReadings.value })
    .from(kpiReadings)
    .where(
      and(
        eq(kpiReadings.kpiId, kpiId),
        eq(kpiReadings.readingDate, day),
        isNull(kpiReadings.deletedAt),
      ),
    );
  return row;
}
export async function selectReading(database: Database, readingId: string) {
  const [row] = await database
    .select({
      id: kpiReadings.id,
      kpiId: kpiReadings.kpiId,
      revision: kpiReadings.revision,
      readingDate: kpiReadings.readingDate,
      value: kpiReadings.value,
      note: kpiReadings.note,
      createdAt: kpiReadings.createdAt,
      deletedAt: kpiReadings.deletedAt,
    })
    .from(kpiReadings)
    .where(eq(kpiReadings.id, readingId));
  return row;
}
export async function insertReading(database: Database, input: typeof kpiReadings.$inferInsert) {
  const [row] = await database.insert(kpiReadings).values(input).returning();
  if (!row) throw new Error('Reading insert failed');
  return row;
}
export function updateReading(
  database: Database,
  readingId: string,
  revision: number,
  patch: EntityPatch<typeof kpiReadings.$inferInsert>,
  actor: string,
) {
  return updateEntity<typeof kpiReadings.$inferSelect>(
    database,
    kpiReadings,
    readingId,
    revision,
    patch,
    actor,
  );
}
export async function upsertTargets(
  database: Database,
  kpiId: string,
  actor: string,
  items: { id: string; year: number; period: number; targetValue: number }[],
) {
  await database
    .insert(kpiTargets)
    .values(items.map((item) => ({ ...item, kpiId, createdBy: actor })))
    .onConflictDoUpdate({
      target: [kpiTargets.kpiId, kpiTargets.year, kpiTargets.period],
      targetWhere: isNull(kpiTargets.deletedAt),
      set: { targetValue: sql`excluded.target_value`, updatedAt: new Date() },
    });
}
export async function deleteTarget(database: Database, targetId: string, opId: string) {
  const [row] = await database
    .update(kpiTargets)
    .set({ deletedAt: new Date(), deletedOpId: opId })
    .where(and(eq(kpiTargets.id, targetId), isNull(kpiTargets.deletedAt)))
    .returning({ id: kpiTargets.id, kpiId: kpiTargets.kpiId });
  return row;
}
const objectiveColumns = {
  ...getTableColumns(objectives),
  kpiCount: sql<number>`(select count(*) from kpis k where k.objective_id = objectives.id and k.deleted_at is null)`,
};
export function selectObjectives(database: Database, includeDeleted: boolean) {
  return database
    .select(objectiveColumns)
    .from(objectives)
    .where(includeDeleted ? undefined : isNull(objectives.deletedAt))
    .orderBy(objectives.sortOrder, objectives.id);
}
export async function selectObjective(database: Database, objectiveId: string) {
  const [row] = await database
    .select(objectiveColumns)
    .from(objectives)
    .where(eq(objectives.id, objectiveId));
  return row;
}
export async function insertObjective(database: Database, input: typeof objectives.$inferInsert) {
  const [row] = await database
    .insert(objectives)
    .values({
      ...input,
      sortOrder: sql`(select coalesce(max(sort_order), -1) + 1 from objectives)`,
    })
    .returning();
  if (!row) throw new Error('Objective insert failed');
  return row;
}
export function updateObjective(
  database: Database,
  objectiveId: string,
  revision: number,
  patch: EntityPatch<typeof objectives.$inferInsert>,
  actor: string,
) {
  return updateEntity<typeof objectives.$inferSelect>(
    database,
    objectives,
    objectiveId,
    revision,
    patch,
    actor,
  );
}
export function restoreObjective(
  database: Database,
  objectiveId: string,
  opId: string,
  actor: string,
) {
  return restoreEntity<typeof objectives.$inferSelect>(
    database,
    objectives,
    objectiveId,
    opId,
    actor,
  );
}
// SEARCH: the workspace-wide provider (ADR 0021).
export async function searchKpis(database: Database, normalized: string, limit: number) {
  return database
    .select({
      id: kpis.id,
      title: kpis.name,
      subtitle: kpis.category,
      rank: searchRank(kpis.searchText, normalized),
    })
    .from(kpis)
    .where(and(isNull(kpis.deletedAt), searchMatch(kpis.searchText, normalized)))
    .orderBy(searchRank(kpis.searchText, normalized), sql`lower(${kpis.name})`)
    .limit(limit);
}
// NOTIF-B06: the live measures a notification can still point at.
export async function selectKpiSubjects(database: Database, ids: readonly string[]) {
  if (!ids.length) return [];
  return database
    .select({ id: kpis.id, title: kpis.name })
    .from(kpis)
    .where(and(inArray(kpis.id, [...ids]), isNull(kpis.deletedAt)));
}
