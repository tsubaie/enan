/** KPIS-B32: an executive brief over a scope of the scorecard, grounded in a digest of its figures. */
import 'server-only';
import { createHash } from 'node:crypto';
import type { Context } from '@/core/auth/session';
import { transactional } from '@/core/db/transaction';
import { admitAi, availableCapabilities } from '@/core/ai/admission';
import { id } from '@/core/db/ids';
import { AppError } from '@/core/http/errors';
import { listKpis } from '../service';
import { KpiListQuery, Narrative, type Kpi, type NarrativeScope } from '../schema/validation';
import * as repo from './repo';
// The owners' notes a brief reads per measure: enough to say why, not a history.
const NOTES_PER_KPI = 2;
const listPeriod = (period: NarrativeScope['period']) => (period === 'current' ? '' : period);
const where = (scope: NarrativeScope) => ({
  kpiId: scope.kpiId ?? null,
  objectiveId: scope.objectiveId ?? null,
  locale: scope.locale,
  period: scope.period,
});
// What a brief is written from: each measure's figures as the scorecard reads them for the period,
// and the newest of its owner's notes. Each is cited by a short code rather than by its id.
function factOf(kpi: Kpi, index: number, notes: { date: string; note: string }[]) {
  const { meta } = kpi;
  return {
    id: kpi.id,
    code: `K${index + 1}`,
    name: kpi.name,
    objective: kpi.objectiveName,
    owner: kpi.ownerName,
    unit: kpi.unit,
    direction: kpi.direction,
    frequency: kpi.frequency,
    status: meta.status,
    current: meta.current,
    currentDate: meta.currentDate,
    previous: meta.previous,
    percentChange: meta.percentChange,
    target: meta.effectiveTarget,
    targetPeriod: meta.effectiveTargetPeriod,
    achievement: meta.achievement,
    notes,
  };
}
async function scopeFacts(ctx: Context, scope: NarrativeScope) {
  // shortcut: a brief covers the first 200 measures the scorecard lists; page through listKpis if
  // a workspace ever holds more than that.
  const listed = await listKpis(
    ctx,
    KpiListQuery.parse({
      view: 'all',
      objectiveId: scope.objectiveId ?? '',
      period: listPeriod(scope.period),
      limit: 200,
    }),
  );
  const kpis = listed.data.filter((kpi) => !scope.kpiId || kpi.id === scope.kpiId);
  if (scope.kpiId && !kpis.length) throw new AppError('not_found');
  const notes = await repo.selectRecentNotes(
    ctx.db,
    kpis.map((kpi) => kpi.id),
  );
  const facts = kpis.map((kpi, index) =>
    factOf(
      kpi,
      index,
      notes
        .filter((row) => row.kpiId === kpi.id)
        .slice(0, NOTES_PER_KPI)
        .map(({ date, note }) => ({ date, note })),
    ),
  );
  // The digest covers the figures alone, so the same figures read in either language agree.
  const dataHash = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
  return { facts, dataHash };
}
function view(row: Awaited<ReturnType<typeof repo.selectLatestNarrative>>, dataHash: string) {
  const narrative = row ? Narrative.parse({ ...row, highlights: row.highlights ?? [] }) : null;
  return {
    narrative,
    currentDataHash: dataHash,
    isStale: narrative ? narrative.dataHash !== dataHash : false,
  };
}
export async function readNarrative(ctx: Context, scope: NarrativeScope) {
  const { dataHash } = await scopeFacts(ctx, scope);
  return view(await repo.selectLatestNarrative(ctx.db, where(scope)), dataHash);
}
// A brief already written, or being written, from the same figures is the answer; only a change in
// the figures, or a failure, asks the model again.
export const startNarrative = transactional(async function startNarrative(
  ctx: Context,
  scope: NarrativeScope,
) {
  if (!(await availableCapabilities(ctx)).includes('kpis.narrative'))
    throw new AppError('ai_unavailable');
  const { facts, dataHash } = await scopeFacts(ctx, scope);
  if (!facts.length) throw new AppError('rule_violation', { rule: 'KPIS-B32' });
  const latest = await repo.selectLatestNarrative(ctx.db, where(scope));
  if (latest && latest.dataHash === dataHash && latest.status !== 'failed')
    return view(latest, dataHash);
  const narrativeId = id();
  await repo.insertNarrative(ctx.db, {
    id: narrativeId,
    kpiId: scope.kpiId ?? null,
    objectiveId: scope.objectiveId ?? null,
    locale: scope.locale,
    periodMode: scope.period,
    dataHash,
    createdBy: ctx.user.id,
  });
  const input = { locale: scope.locale, period: scope.period, kpis: facts };
  const job = await admitAi(ctx, 'kpis.narrative', narrativeId, 1, input);
  await repo.attachNarrativeJob(ctx.db, narrativeId, job.id);
  return view(await repo.selectLatestNarrative(ctx.db, where(scope)), dataHash);
});
