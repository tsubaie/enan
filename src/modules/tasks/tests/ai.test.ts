import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { writeSetting } from '@/core/db/settings-repo';
import { readJob } from '@/core/db/admin-repo';
import { harness, actorId } from '@/modules/notes/tests/fixtures';
import { fixtureModel, finishedJob } from '../../../../tests/fixtures/ai/jobs';
import breakdown from '../../../../tests/fixtures/ai/tasks.breakdown.v1.en.json';
import { startBreakdown, applyBreakdown } from '../ai/service';
import { getTask, patchTask } from '../service';
vi.mock('@/core/ai/models', () => ({ loadModels: async () => [fixtureModel] }));
vi.mock('@/core/ai/client', () => ({ aiConnection: () => ({ state: 'enabled' }) }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  await harness.reset();
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, actorId());
});
afterAll(() => closeDatabase());
it('TASKS-B13 snapshots eligible tasks, deduplicates requests and excludes user emails', async () => {
  const task = await harness.task('Prepare launch');
  const first = await harness.run((ctx) => startBreakdown(ctx, task.id, task.revision));
  expect(await harness.run((ctx) => startBreakdown(ctx, task.id, task.revision))).toEqual(first);
  const job = await readJob(db(), first.id);
  expect(JSON.stringify(job?.payload)).not.toContain('@example.test');
  await harness.task('Child', { parentId: task.id });
  await expect(
    harness.run((ctx) => startBreakdown(ctx, task.id, task.revision)),
  ).rejects.toMatchObject({ details: { rule: 'TASKS-B13' } });
});
it('TASKS-B13 TASKS-A06 applies selected subtasks once and refuses stale drafts', async () => {
  const task = await harness.task('Prepare launch');
  const job = await finishedJob(
    db(),
    actorId(),
    'tasks.breakdown',
    task.id,
    task.revision,
    breakdown,
  );
  const first = await harness.run((ctx) =>
    applyBreakdown(ctx, task.id, { jobId: job.id, indexes: [0, 1] }),
  );
  expect(first.ids).toHaveLength(2);
  expect(
    await harness.run((ctx) => applyBreakdown(ctx, task.id, { jobId: job.id, indexes: [0, 1] })),
  ).toEqual(first);
  expect((await harness.run((ctx) => getTask(ctx, task.id))).subtasks).toHaveLength(2);
  const other = await harness.task('Another task');
  const stale = await finishedJob(
    db(),
    actorId(),
    'tasks.breakdown',
    other.id,
    other.revision,
    breakdown,
  );
  await harness.run((ctx) =>
    patchTask(ctx, other.id, { revision: other.revision, title: 'Changed' }),
  );
  await expect(
    harness.run((ctx) => applyBreakdown(ctx, other.id, { jobId: stale.id, indexes: [0] })),
  ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'revision' } });
});
it('TASKS-A07 disabled capabilities refuse admission', async () => {
  const task = await harness.task('Disabled');
  await writeSetting(db(), 'ai.enabled_capabilities', [], actorId());
  await expect(
    harness.run((ctx) => startBreakdown(ctx, task.id, task.revision)),
  ).rejects.toMatchObject({ code: 'ai_unavailable' });
});
it('ADMIN-B36 a direct breakdown apply that fails partway rolls the whole batch back', async () => {
  const task = await harness.task('Review partial apply');
  const job = await finishedJob(
    db(),
    actorId(),
    'tasks.breakdown',
    task.id,
    task.revision,
    breakdown,
  );
  const user = harness.user;
  if (!user) throw new Error('reset the harness before running a scenario');
  // The pool, not harness.run: a script or another module calls the service without a transaction.
  const ctx = { db: db(), user, requestId: crypto.randomUUID() };
  await expect(
    applyBreakdown(ctx, task.id, { jobId: job.id, indexes: [0, 999] }),
  ).rejects.toMatchObject({ code: 'validation_failed' });
  expect((await getTask(ctx, task.id)).subtasks).toHaveLength(0);
  expect((await applyBreakdown(ctx, task.id, { jobId: job.id, indexes: [0] })).ids).toHaveLength(1);
});
