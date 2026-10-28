import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { writeSetting } from '@/core/db/settings-repo';
import { jobs } from '@/core/db/system-schema';
import { periodOf, periodRange, shiftPeriod } from '@/core/time/kpis';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
import { kpiNarratives } from '../schema/db';
import { NarrativeScope } from '../schema/validation';
import { readNarrative, startNarrative } from '../ai/service';
import { narrativeJob } from '../ai/job';
import { harness, workspaceToday } from './fixtures';
vi.mock('@/core/ai/models', () => ({ loadModels: async () => [fixtureModel] }));
vi.mock('@/core/ai/client', () => ({ aiConnection: () => ({ state: 'enabled' }) }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await harness.reset();
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, harness.user?.id ?? '');
});
afterAll(() => closeDatabase());
const scope = NarrativeScope.parse({});
const read = (input = scope) => harness.run((ctx) => readNarrative(ctx, input));
const start = (input = scope) => harness.run((ctx) => startNarrative(ctx, input));
async function scorecard() {
  const today = await workspaceToday();
  const kpi = await harness.kpi('Board pack on time');
  await harness.reading(kpi.id, today, 40, 'Two papers late');
  return { kpi, today };
}
// A day in the previous quarter: a reading there moves the change the figures state (KPIS-B04).
const lastQuarter = (today: string) =>
  periodRange(shiftPeriod(periodOf(today, 'quarterly'), -1, 'quarterly'), 'quarterly').from;
async function jobOf(narrativeId: string) {
  const [row] = await db().select().from(kpiNarratives).where(eq(kpiNarratives.id, narrativeId));
  const [job] = await db()
    .select()
    .from(jobs)
    .where(eq(jobs.id, row?.jobId ?? ''));
  if (!job) throw new Error('no job');
  return job;
}
it('KPIS-B32 the digest is stable for the same figures and moves when a reading does', async () => {
  const { kpi, today } = await scorecard();
  const first = await read();
  expect(first).toMatchObject({ narrative: null, isStale: false });
  expect(first.currentDataHash).toMatch(/^[0-9a-f]{64}$/u);
  expect((await read()).currentDataHash).toBe(first.currentDataHash);
  // Either language reads the same figures, so the digest does not depend on it.
  expect((await read(NarrativeScope.parse({ locale: 'ar' }))).currentDataHash).toBe(
    first.currentDataHash,
  );
  await harness.reading(kpi.id, lastQuarter(today), 35);
  expect((await read()).currentDataHash).not.toBe(first.currentDataHash);
});
it('KPIS-B32 a brief is asked for once per set of figures, written from cited measures, and goes stale', async () => {
  const { kpi, today } = await scorecard();
  const asked = await start();
  const narrative = asked.narrative;
  if (!narrative) throw new Error('no brief');
  expect(narrative).toMatchObject({ status: 'generating', locale: 'en', periodMode: 'current' });
  // The same figures asked again are the same brief, not a second job.
  expect((await start()).narrative?.id).toBe(narrative.id);
  const job = await jobOf(narrative.id);
  const output = {
    headline: 'One measure is off target.',
    bodyMarkdown: 'Board pack on time reads 40.',
    highlights: [
      { code: 'K1', summary: 'Two papers were late.' },
      { code: 'K9', summary: 'A measure that was never in the figures.' },
    ],
  };
  await withTransaction(db(), (database) =>
    narrativeJob.publish(database, job, { output, warnings: [] }),
  );
  const ran = await read();
  expect(ran.narrative).toMatchObject({ status: 'ready', headline: output.headline });
  expect(ran.narrative?.highlights).toEqual([
    {
      kpiId: kpi.id,
      code: 'K1',
      name: 'Board pack on time',
      status: 'no_target',
      summary: 'Two papers were late.',
    },
  ]);
  expect(ran.isStale).toBe(false);
  await harness.reading(kpi.id, lastQuarter(today), 35);
  expect((await read()).isStale).toBe(true);
});
it('KPIS-B32 a brief whose job failed reads as failed and can be asked for again', async () => {
  await scorecard();
  const asked = await start();
  const job = await jobOf(asked.narrative?.id ?? '');
  await db()
    .update(jobs)
    .set({ status: 'failed', lastError: 'provider' })
    .where(eq(jobs.id, job.id));
  expect((await read()).narrative?.status).toBe('failed');
  const again = await start();
  expect(again.narrative?.status).toBe('generating');
  expect(again.narrative?.id).not.toBe(asked.narrative?.id);
});
it('KPIS-B32 a brief needs a measure and an available capability', async () => {
  await expect(start()).rejects.toMatchObject({ code: 'rule_violation' });
  await scorecard();
  await writeSetting(db(), 'ai.enabled_capabilities', [], harness.user?.id ?? '');
  await expect(start()).rejects.toMatchObject({ code: 'ai_unavailable' });
});
