import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase, withTransaction } from '@/core/db/client';
import { prune } from '@/core/db/jobs-repo';
import { migrateDatabase } from '@/core/db/migrate';
import { writeSetting } from '@/core/db/settings-repo';
import { createTask } from '@/modules/tasks';
import { TaskCreate } from '@/modules/tasks/schema/validation';
import { fixtureModel, finishedJob } from '../../../../tests/fixtures/ai/jobs';
import refinement from '../../../../tests/fixtures/ai/notes.refine.v1.en.json';
import suggestedTags from '../../../../tests/fixtures/ai/notes.tags.v1.en.json';
import { harness, actorId } from './fixtures';
import { startNoteAi } from '../ai/service';
import { refinePrompt } from '../ai/prompts/select';
import { NoteAiApply } from '../schema/validation';
import { insertRefinement } from '../repo';
import { id } from '@/core/db/ids';
import { AiPayload } from '@/core/ai/job-schema';
import { latestAiJob } from '@/core/db/ai-jobs-repo';
import { applyNoteAi, discardNoteAi, restoreNoteAi } from '../ai/apply';
import { getNote, patchNote } from '../service';
import { noteJobs } from '../jobs';
const provider = vi.hoisted(() => ({ output: {} as object }));
vi.mock('@/core/ai/execute', () => ({ executeAi: async () => provider.output }));
vi.mock('@/core/ai/models', () => ({ loadModels: async () => [fixtureModel] }));
vi.mock('@/core/ai/client', () => ({ aiConnection: () => ({ state: 'enabled' }) }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await harness.reset();
  await writeSetting(db(), 'ai.model.default', fixtureModel.id, actorId());
  await writeSetting(db(), 'ai.model.fast', fixtureModel.id, actorId());
});
afterAll(() => closeDatabase());
it('NOTES-B17 applies reviewed content, tags and tasks atomically and once', async () => {
  const person = await harness.person('Alex', { isAssignable: true });
  const note = await harness.note('Plan', { content: 'Review the draft with @Alex.' });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  const apply = () =>
    harness.run((ctx) =>
      applyNoteAi(
        ctx,
        note.id,
        { jobId: job.id, acceptContent: true, taskIndexes: [0], tagIndexes: [0] },
        'notes.refine',
        async (tx, task, ownerId) =>
          (
            await createTask(
              tx,
              TaskCreate.parse({ title: task.title, ownerId, sourceNoteId: note.id }),
            )
          ).id,
      ),
    );
  const first = await apply();
  expect(await apply()).toEqual(first);
  const updated = await harness.run((ctx) => getNote(ctx, note.id));
  expect(updated.content).toBe(refinement.refined_content);
  expect(updated.tags).toEqual(['planning']);
  expect(updated.tasks).toHaveLength(1);
  expect(updated.participants.map((item) => item.id)).toEqual([person.id]);
});
it('NOTES-B17 rejects stale suggestions without creating tasks or replacing content', async () => {
  const note = await harness.note('Plan');
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  await harness.run((ctx) =>
    patchNote(ctx, note.id, { revision: note.revision, content: 'Edited' }),
  );
  const create = vi.fn();
  await expect(
    harness.run((ctx) =>
      applyNoteAi(
        ctx,
        note.id,
        { jobId: job.id, acceptContent: true, taskIndexes: [0], tagIndexes: [] },
        'notes.refine',
        create,
      ),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(create).not.toHaveBeenCalled();
  expect((await harness.run((ctx) => getNote(ctx, note.id))).content).toBe('Edited');
});
it('NOTES-B17 NOTES-A10 disabled capabilities refuse both note entry points', async () => {
  const note = await harness.note('Disabled');
  await writeSetting(db(), 'ai.enabled_capabilities', [], actorId());
  for (const capability of ['notes.refine', 'notes.suggest_tags'] as const)
    await expect(
      harness.run((ctx) => startNoteAi(ctx, note.id, note.revision, capability)),
    ).rejects.toMatchObject({ code: 'ai_unavailable' });
});
it('NOTES-B18 applies edited task titles and preserves repeat-apply protection', async () => {
  const note = await harness.note('Plan', { content: 'Review the draft.' });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  const create = vi.fn().mockResolvedValue('00000000-0000-4000-8000-000000000001');
  const input = {
    jobId: job.id,
    acceptContent: true,
    taskIndexes: [0],
    tagIndexes: [],
    taskTitles: [{ index: 0, title: 'Review the revised draft' }],
  };
  const apply = () =>
    harness.run((ctx) => applyNoteAi(ctx, note.id, input, 'notes.refine', create));
  const first = await apply();
  expect(await apply()).toEqual(first);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[1]).toMatchObject({ title: 'Review the revised draft' });
});
it('NOTES-B18 Apply Note Only updates content and selected tags without creating tasks', async () => {
  const note = await harness.note('Plan', { content: 'Review the draft.' });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  const create = vi.fn();
  await harness.run((ctx) =>
    applyNoteAi(
      ctx,
      note.id,
      {
        jobId: job.id,
        acceptContent: true,
        taskIndexes: [],
        tagIndexes: [0],
        taskTitles: [],
      },
      'notes.refine',
      create,
    ),
  );
  expect(create).not.toHaveBeenCalled();
  const updated = await harness.run((ctx) => getNote(ctx, note.id));
  expect(updated.content).toBe(refinement.refined_content);
  expect(updated.tags).toContain('planning');
});
it('NOTES-B08 NOTES-B18 applying suggestions keeps a participant mentioned by display name', async () => {
  const sam = await harness.person('Samuel Smith', { displayName: 'Sam' });
  const note = await harness.note('Plan', {
    content: 'Review the draft with @Sam.',
    participantIds: [sam.id],
  });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  await harness.run((ctx) =>
    applyNoteAi(
      ctx,
      note.id,
      { jobId: job.id, acceptContent: false, taskIndexes: [], tagIndexes: [0], taskTitles: [] },
      'notes.refine',
      vi.fn(),
    ),
  );
  const updated = await harness.run((ctx) => getNote(ctx, note.id));
  expect(updated.participants.map((row) => row.id)).toEqual([sam.id]);
});
it('NOTES-B08 NOTES-B18 applying tags alone leaves the body and the participants picked by hand', async () => {
  for (const [capability, output] of [
    ['notes.suggest_tags', suggestedTags],
    ['notes.refine', refinement],
  ] as const) {
    const pat = await harness.person(`Pat ${capability}`);
    const note = await harness.note('Plan', {
      content: 'Review the draft.',
      participantIds: [pat.id],
    });
    const job = await finishedJob(db(), actorId(), capability, note.id, note.revision, output);
    await harness.run((ctx) =>
      applyNoteAi(
        ctx,
        note.id,
        { jobId: job.id, acceptContent: false, taskIndexes: [], tagIndexes: [0], taskTitles: [] },
        capability,
        vi.fn(),
      ),
    );
    const updated = await harness.run((ctx) => getNote(ctx, note.id));
    expect(updated.content).toBe('Review the draft.');
    expect(updated.tags).toEqual(['planning']);
    expect(updated.participants.map((row) => row.id)).toEqual([pat.id]);
  }
});
it('NOTES-B08 NOTES-B18 accepted content adds who it mentions and keeps participants it does not', async () => {
  const alex = await harness.person('Alex');
  const pat = await harness.person('Pat');
  const note = await harness.note('Plan', {
    content: 'Review the draft.',
    participantIds: [pat.id],
  });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  await harness.run((ctx) =>
    applyNoteAi(
      ctx,
      note.id,
      { jobId: job.id, acceptContent: true, taskIndexes: [], tagIndexes: [], taskTitles: [] },
      'notes.refine',
      vi.fn(),
    ),
  );
  const updated = await harness.run((ctx) => getNote(ctx, note.id));
  expect(updated.content).toBe(refinement.refined_content);
  expect(updated.participants.map((row) => row.id).sort()).toEqual([alex.id, pat.id].sort());
});
it('NOTES-B26 refine jobs are admitted with prompt v3, which keeps checklist markers out of refined content, and older versions stay executable', async () => {
  const note = await harness.note('Plan', { content: 'Review the draft.' });
  const started = await harness.run((ctx) =>
    startNoteAi(ctx, note.id, note.revision, 'notes.refine'),
  );
  const job = await latestAiJob(db(), actorId(), note.id, 'ai.notes.refine');
  expect(job?.id).toBe(started.id);
  expect(AiPayload.parse(job?.payload).promptVersion).toBe(3);
  expect(refinePrompt(3)).toMatch(/never write checklist markers/iu);
  expect(refinePrompt(3)).toMatch(/keep any checklist marker that already exists/iu);
  expect(refinePrompt(3)).toMatch(/level two/iu);
  expect(refinePrompt(2)).not.toMatch(/checklist/iu);
  expect(refinePrompt(1)).not.toMatch(/checklist/iu);
  expect(refinePrompt(2)).not.toBe(refinePrompt(3));
});
it('NOTES-B18 Keep applies the rewrite as the reader edited it, and an edit without accepting content is refused', async () => {
  const note = await harness.note('Plan', { content: 'Review the draft.' });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  await harness.run((ctx) =>
    applyNoteAi(
      ctx,
      note.id,
      {
        jobId: job.id,
        acceptContent: true,
        content: '## Edited\n\nBy hand.',
        taskIndexes: [],
        tagIndexes: [],
      },
      'notes.refine',
      async () => '00000000-0000-4000-8000-000000000001',
    ),
  );
  expect((await harness.run((ctx) => getNote(ctx, note.id))).content).toBe('## Edited\n\nBy hand.');
  expect(
    NoteAiApply.safeParse({
      jobId: job.id,
      acceptContent: false,
      content: 'x',
      taskIndexes: [],
      tagIndexes: [0],
    }).success,
  ).toBe(false);
});
it('NOTES-B18 a discarded proposal can be restored until it is applied, and comes back stale when the note moved on', async () => {
  const note = await harness.note('Plan', { content: 'Review the draft.' });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  await harness.run((ctx) => discardNoteAi(ctx, note.id, job.id, 'notes.refine'));
  await expect(
    harness.run((ctx) =>
      applyNoteAi(
        ctx,
        note.id,
        { jobId: job.id, acceptContent: true, taskIndexes: [], tagIndexes: [] },
        'notes.refine',
        async () => 'x',
      ),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  await harness.run((ctx) => restoreNoteAi(ctx, note.id, job.id));
  const applied = await harness.run((ctx) =>
    applyNoteAi(
      ctx,
      note.id,
      { jobId: job.id, acceptContent: true, taskIndexes: [], tagIndexes: [] },
      'notes.refine',
      async () => 'x',
    ),
  );
  expect(applied.ids).toEqual([]);
  await expect(harness.run((ctx) => restoreNoteAi(ctx, note.id, job.id))).rejects.toMatchObject({
    code: 'conflict',
  });
  // A second proposal, discarded after the note moved on, restores as stale rather than pending.
  const moved = await harness.run((ctx) => getNote(ctx, note.id));
  const later = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    moved.revision,
    refinement,
  );
  await insertRefinement(db(), {
    id: id(),
    noteId: note.id,
    jobId: later.id,
    noteRevision: moved.revision,
    contentHash: 'fixture',
    capabilityVersion: 1,
    refinedContent: refinement.refined_content,
    suggestedTasks: refinement.suggested_tasks,
    suggestedTags: refinement.suggested_tags,
    summaryOfChanges: refinement.summary_of_changes,
    status: 'pending',
    createdBy: actorId(),
  });
  await harness.run((ctx) =>
    patchNote(ctx, note.id, { revision: moved.revision, title: 'Plan 2' }),
  );
  await harness.run((ctx) => discardNoteAi(ctx, note.id, later.id, 'notes.refine'));
  await harness.run((ctx) => restoreNoteAi(ctx, note.id, later.id));
  const rows = await db().all<{ status: string }>(
    sql`select status from note_refinements where job_id = ${later.id}`,
  );
  expect(rows[0]?.status).toBe('stale');
});
it('NOTES-B18 restoring a discarded proposal is refused with 409 while a newer one is pending', async () => {
  const note = await harness.note('Plan', { content: 'Review the draft.' });
  const row = (jobId: string, status: string) => ({
    id: id(),
    noteId: note.id,
    jobId,
    noteRevision: note.revision,
    contentHash: 'fixture',
    capabilityVersion: 1,
    refinedContent: refinement.refined_content,
    suggestedTasks: refinement.suggested_tasks,
    suggestedTags: refinement.suggested_tags,
    summaryOfChanges: refinement.summary_of_changes,
    status,
    createdBy: actorId(),
  });
  const first = await finishedJob(db(), actorId(), 'notes.refine', note.id, note.revision, refinement);
  await insertRefinement(db(), row(first.id, 'pending'));
  await harness.run((ctx) => discardNoteAi(ctx, note.id, first.id, 'notes.refine'));
  const second = await finishedJob(db(), actorId(), 'notes.refine', note.id, note.revision, refinement);
  await insertRefinement(db(), row(second.id, 'pending'));
  await expect(harness.run((ctx) => restoreNoteAi(ctx, note.id, first.id))).rejects.toMatchObject({
    code: 'conflict',
    details: { reason: 'state' },
  });
  const rows = await db().all<{ status: string }>(
    sql`select status from note_refinements where job_id = ${first.id}`,
  );
  expect(rows[0]?.status).toBe('discarded');
});
it('NOTES-B17 a blank tag from the model is dropped instead of failing the job', async () => {
  const note = await harness.note('Plan', { content: 'Review the board draft.' });
  const signal = new AbortController().signal;
  provider.output = { tags: [' ', 'board'] };
  const tagJob = await finishedJob(db(), actorId(), 'notes.suggest_tags', note.id, note.revision, {});
  expect(await noteJobs['ai.notes.suggest_tags']?.run(tagJob, signal)).toEqual({
    output: { tags: ['board'] },
    warnings: [],
  });
  provider.output = { ...refinement, suggested_tasks: [], suggested_tags: [' ', 'board'] };
  const refineJob = await finishedJob(db(), actorId(), 'notes.refine', note.id, note.revision, {}, {
    assignablePeople: [],
    content: note.content,
  });
  const refined = await noteJobs['ai.notes.refine']?.run(refineJob, signal);
  expect(refined?.output).toMatchObject({ suggested_tags: ['board'] });
});
it('ADMIN-B36 a direct note apply that fails after creating a task leaves no task and no change', async () => {
  const note = await harness.note('Plan', { content: 'draft content' });
  const job = await finishedJob(
    db(),
    actorId(),
    'notes.refine',
    note.id,
    note.revision,
    refinement,
  );
  const user = harness.user;
  if (!user) throw new Error('reset the harness before running a scenario');
  // The pool, not harness.run: a script or another module calls the service without a transaction.
  const ctx = { db: db(), user, requestId: crypto.randomUUID() };
  const input = { jobId: job.id, acceptContent: true, taskIndexes: [0], tagIndexes: [0] };
  await expect(
    applyNoteAi(ctx, note.id, input, 'notes.refine', async (tx, task, ownerId) => {
      await createTask(tx, TaskCreate.parse({ title: task.title, ownerId, sourceNoteId: note.id }));
      throw new Error('injected after the task insert');
    }),
  ).rejects.toThrow('injected after the task insert');
  const unchanged = await getNote(ctx, note.id);
  expect(unchanged.tasks).toHaveLength(0);
  expect(unchanged.content).toBe('draft content');
  expect(unchanged.tags).toEqual([]);
});
it('ADMIN-B12 the nightly prune keeps an old refine job a refinement still names, and still succeeds', async () => {
  const note = await harness.note('Plan', { content: 'Review the draft.' });
  const kept = await finishedJob(db(), actorId(), 'notes.refine', note.id, note.revision, refinement);
  await insertRefinement(db(), {
    id: id(),
    noteId: note.id,
    jobId: kept.id,
    noteRevision: note.revision,
    contentHash: 'fixture',
    capabilityVersion: 1,
    refinedContent: refinement.refined_content,
    suggestedTasks: refinement.suggested_tasks,
    suggestedTags: refinement.suggested_tags,
    summaryOfChanges: refinement.summary_of_changes,
    status: 'discarded',
    createdBy: actorId(),
  });
  // Past the 30 days: the referenced one is the oldest, so only the reference keeps it; of the
  // two others the newest success stays and the older one goes.
  const old = new Date(Date.now() - 40 * 86400000).getTime();
  const gone = await finishedJob(db(), actorId(), 'notes.refine', note.id, note.revision, refinement);
  const newest = await finishedJob(db(), actorId(), 'notes.refine', note.id, note.revision, refinement);
  for (const [job, age] of [[kept, 3000], [gone, 2000], [newest, 1000]] as const)
    await db().run(sql`update jobs set finished_at = ${old - age} where id = ${job.id}`);
  await withTransaction(db(), (database) => prune(database));
  const left = await db().all<{ id: string }>(sql`select id from jobs where kind = ${kept.kind}`);
  expect(left.map((row) => row.id).sort()).toEqual([kept.id, newest.id].sort());
});
