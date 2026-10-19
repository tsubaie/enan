import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { createHarness } from '@/core/db/test-harness';
import { writeSetting } from '@/core/db/settings-repo';
import { readJob } from '@/core/db/admin-repo';
import { lockedAiJob, recordInvocation, requestAiCancellation } from '@/core/db/ai-jobs-repo';
import { id } from '@/core/db/ids';
import { fixtureModel } from '../../../../tests/fixtures/ai/jobs';
import { admitAi } from '../admission';
import { failedUsage } from '../usage';
import { AiPayload } from '../job-schema';
vi.mock('../models', () => ({ loadModels: async () => [fixtureModel] }));
vi.mock('../client', () => ({ aiConnection: () => ({ state: 'enabled' }) }));
// ADMIN-B26 ADMIN-B45 (ADR 0033): the monthly AI limit is money. Admission reserves the most a
// request's two attempts can cost at the selected model's prices and refuses a request when what
// the month has spent, plus what active jobs have reserved, plus this reservation, passes it.
const harness = createHarness({ name: 'Budget Tester', email: 'budget@example.test' });
const actor = () => harness.user?.id ?? '';
const admit = (entityId = id()) =>
  harness.run((ctx) => admitAi(ctx, 'tasks.breakdown', entityId, 1, { title: 'Plan the offsite' }));
const reservation = async (jobId: string) =>
  AiPayload.parse((await readJob(db(), jobId))?.payload).reservedCostMicros;
const spend = (estimatedCostMicros: number) =>
  recordInvocation(db(), {
    id: id(),
    capability: 'tasks.breakdown',
    capabilityVersion: 1,
    requestedModel: fixtureModel.id,
    status: 'ok',
    estimatedCostMicros,
  });
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await harness.reset();
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, actor());
});
afterAll(() => closeDatabase());
it('ADMIN-B26 a request reserves the most its two attempts can cost at the model prices', async () => {
  const job = await admit();
  const reserved = await reservation(job.id);
  const payload = AiPayload.parse((await readJob(db(), job.id))?.payload);
  // Two attempts of the estimated input at the input price and the full output allowance at the
  // output price, in micro-dollars, rounded up.
  const input = payload.reservedTokens / 2 - payload.maxOutputTokens;
  expect(reserved).toBe(
    Math.ceil(
      2 * 1000000 * (fixtureModel.inputPrice * input + fixtureModel.outputPrice * payload.maxOutputTokens),
    ),
  );
  expect(reserved).toBeGreaterThan(0);
});
it('ADMIN-B26 with no dollar limit every request is admitted', async () => {
  await spend(1e12);
  await expect(admit()).resolves.toMatchObject({ id: expect.any(String) });
});
it('ADMIN-B26 a request whose reservation alone passes the dollar limit is refused as budget', async () => {
  await writeSetting(db(), 'ai.monthly_budget_micros', 1000, actor());
  await expect(admit()).rejects.toMatchObject({
    code: 'ai_unavailable',
    details: { reason: 'budget' },
  });
});
it('ADMIN-B26 active reservations count against the dollar limit until the job ends, then only its spend counts', async () => {
  const first = await admit();
  const reserved = await reservation(first.id);
  await writeSetting(db(), 'ai.monthly_budget_micros', Math.floor(reserved * 1.5), actor());
  await expect(admit()).rejects.toMatchObject({ details: { reason: 'budget' } });
  // The first job ends having spent a quarter of its reservation: the rest is released.
  const job = await lockedAiJob(db(), first.id);
  if (!job) throw new Error('job missing');
  await requestAiCancellation(db(), job);
  await spend(Math.ceil(reserved / 4));
  await expect(admit()).resolves.toMatchObject({ id: expect.any(String) });
});
it('ADMIN-B26 what the month has already spent counts against the dollar limit', async () => {
  await writeSetting(db(), 'ai.monthly_budget_micros', 5000000, actor());
  await spend(4990000);
  await expect(admit()).rejects.toMatchObject({ details: { reason: 'budget' } });
});
it('ADMIN-B26 a call whose usage was lost keeps half the dollar reservation as its estimated cost', () => {
  const payload = AiPayload.parse({
    capability: 'tasks.breakdown',
    capabilityVersion: 1,
    promptVersion: 1,
    entityId: id(),
    revision: 1,
    contentHash: 'fixture',
    model: fixtureModel,
    locale: 'en',
    input: {},
    reservedTokens: 10000,
    reservedCostMicros: 30001,
    maxOutputTokens: 4096,
  });
  expect(failedUsage(null, payload)).toMatchObject({ inputTokens: 5000, estimatedCostMicros: 15001 });
  // A job snapshotted before the dollar limit carries no cost reservation and keeps none.
  const legacy = AiPayload.parse({ ...payload, reservedCostMicros: undefined });
  expect(legacy.reservedCostMicros).toBe(0);
  expect(failedUsage(null, legacy).estimatedCostMicros).toBeNull();
});
