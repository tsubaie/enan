import 'server-only';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/client';
import { kpiNarratives, kpiReadings } from '../schema/db';
type Highlight = { kpiId: string; code: string; name: string; status: string; summary: string };
type Scope = { kpiId: string | null; objectiveId: string | null; locale: string; period: string };
// KPIS-B32: a brief that was asked for and whose job has since failed or been cancelled is a
// failed brief, without anything having to write that back: the job's state is the truth.
const effectiveStatus = sql<string>`case when ${kpiNarratives.status} = 'generating' and
  coalesce((select j.status from jobs j where j.id = ${kpiNarratives.jobId}), 'failed')
  in ('failed', 'cancelled') then 'failed' else ${kpiNarratives.status} end`;
const scoped = (scope: Scope) =>
  and(
    scope.kpiId ? eq(kpiNarratives.kpiId, scope.kpiId) : isNull(kpiNarratives.kpiId),
    scope.objectiveId
      ? eq(kpiNarratives.objectiveId, scope.objectiveId)
      : isNull(kpiNarratives.objectiveId),
    eq(kpiNarratives.locale, scope.locale),
    eq(kpiNarratives.periodMode, scope.period),
    isNull(kpiNarratives.deletedAt),
  );
export async function selectLatestNarrative(database: Database, scope: Scope) {
  const [row] = await database
    .select({
      id: kpiNarratives.id,
      kpiId: kpiNarratives.kpiId,
      objectiveId: kpiNarratives.objectiveId,
      locale: kpiNarratives.locale,
      periodMode: kpiNarratives.periodMode,
      dataHash: kpiNarratives.dataHash,
      status: effectiveStatus,
      headline: kpiNarratives.headline,
      bodyMarkdown: kpiNarratives.bodyMarkdown,
      highlights: kpiNarratives.highlightsJson,
      error: kpiNarratives.error,
      createdAt: kpiNarratives.createdAt,
    })
    .from(kpiNarratives)
    .where(scoped(scope))
    .orderBy(desc(kpiNarratives.createdAt), desc(kpiNarratives.id))
    .limit(1);
  return row;
}
export async function insertNarrative(
  database: Database,
  input: typeof kpiNarratives.$inferInsert,
) {
  const [row] = await database.insert(kpiNarratives).values(input).returning();
  if (!row) throw new Error('Narrative insert failed');
  return row;
}
export async function attachNarrativeJob(database: Database, narrativeId: string, jobId: string) {
  await database.update(kpiNarratives).set({ jobId }).where(eq(kpiNarratives.id, narrativeId));
}
export async function completeNarrative(
  database: Database,
  narrativeId: string,
  fields: { headline: string; bodyMarkdown: string; highlightsJson: Highlight[] },
) {
  await database
    .update(kpiNarratives)
    .set({ ...fields, status: 'ready', updatedAt: new Date() })
    .where(and(eq(kpiNarratives.id, narrativeId), eq(kpiNarratives.status, 'generating')));
}
// The owners' own words on the newest few readings of each measure: the one field that says *why*
// a number moved (KPIS-B04), and so part of what a brief is grounded in.
export async function selectRecentNotes(database: Database, kpiIds: readonly string[]) {
  if (!kpiIds.length) return [];
  return database
    .select({
      kpiId: kpiReadings.kpiId,
      date: kpiReadings.readingDate,
      note: kpiReadings.note,
    })
    .from(kpiReadings)
    .where(
      and(
        inArray(kpiReadings.kpiId, [...kpiIds]),
        isNull(kpiReadings.deletedAt),
        sql`trim(${kpiReadings.note}) <> ''`,
      ),
    )
    .orderBy(kpiReadings.kpiId, desc(kpiReadings.readingDate), desc(kpiReadings.id));
}
