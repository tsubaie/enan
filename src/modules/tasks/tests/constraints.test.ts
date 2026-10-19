import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { constraintViolation } from '@/core/db/errors';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
import { harness } from './fixtures';
beforeAll(() => migrateDatabase());
beforeEach(() => harness.reset());
afterAll(() => closeDatabase());
// The constraint SQLite reported, or null when the statement went through (ADR 0029).
const violation = <T>(statement: Promise<T>) =>
  statement.then(
    () => null,
    (error: Error) => constraintViolation(error),
  );
type Row = {
  id?: string;
  title?: string;
  status?: string;
  priority?: string | null;
  completedAt?: number | null;
  parentId?: string | null;
  sortOrder?: number;
  committeeId?: string | null;
  ownerId?: string | null;
  sourceNoteId?: string | null;
};
// A raw insert with every column the checks and keys read, bypassing the service entirely.
const insert = (row: Row) =>
  db().run(
    sql`insert into tasks (id, title, status, priority, completed_at, parent_id, sort_order, committee_id, owner_id, source_note_id)
      values (${row.id ?? id()}, ${row.title ?? 'Raw'}, ${row.status ?? 'inbox'}, ${row.priority ?? null},
      ${row.completedAt ?? null}, ${row.parentId ?? null}, ${row.sortOrder ?? 0}, ${row.committeeId ?? null},
      ${row.ownerId ?? null}, ${row.sourceNoteId ?? null})`,
  );
it('TASKS-B01 TASKS-B02 the database holds the status and priority vocabularies and a non-blank title', async () => {
  expect(await violation(insert({ status: 'done' }))).toMatchObject({
    kind: 'check',
    constraint: 'tasks_status_check',
  });
  expect(await violation(insert({ priority: 'critical' }))).toMatchObject({
    kind: 'check',
    constraint: 'tasks_priority_check',
  });
  expect(await violation(insert({ title: '   ' }))).toMatchObject({
    kind: 'check',
    constraint: 'tasks_title_check',
  });
  expect(await violation(insert({ title: 't'.repeat(501) }))).toMatchObject({
    kind: 'check',
    constraint: 'tasks_title_check',
  });
  await expect(insert({ status: 'someday', priority: 'urgent' })).resolves.toBeTruthy();
});
it('TASKS-I03 completed_at is set exactly when the status is completed', async () => {
  expect(await violation(insert({ status: 'completed' }))).toMatchObject({
    kind: 'check',
    constraint: 'tasks_completed_check',
  });
  expect(await violation(insert({ status: 'inbox', completedAt: Date.now() }))).toMatchObject({
    kind: 'check',
    constraint: 'tasks_completed_check',
  });
  await expect(insert({ status: 'completed', completedAt: Date.now() })).resolves.toBeTruthy();
  // The same rule holds on update: neither half of the pair moves alone.
  const task = await harness.task('Open');
  expect(
    await violation(db().run(sql`update tasks set status = 'completed' where id = ${task.id}`)),
  ).toMatchObject({ kind: 'check', constraint: 'tasks_completed_check' });
});
it('TASKS-I01 TASKS-I02 the depth trigger and the self check refuse a grandchild, a parent made a child, and a self-parent', async () => {
  const parent = await harness.task('Parent');
  const child = await harness.task('Child', { parentId: parent.id });
  const grandchildId = id();
  expect(await violation(insert({ id: grandchildId, parentId: child.id }))).toMatchObject({
    kind: 'trigger',
    constraint: 'TASKS-I01 depth one required',
  });
  const loose = await harness.task('Loose');
  // Moving a task under a subtask, and moving a task with children under another, are both depth two.
  expect(
    await violation(db().run(sql`update tasks set parent_id = ${child.id} where id = ${loose.id}`)),
  ).toMatchObject({ kind: 'trigger' });
  expect(
    await violation(
      db().run(sql`update tasks set parent_id = ${loose.id} where id = ${parent.id}`),
    ),
  ).toMatchObject({ kind: 'trigger' });
  // A self-parent is refused twice over: the trigger reads it as depth, the CHECK as identity.
  // Whichever SQLite evaluates first, the row never lands.
  const selfId = id();
  const selfInsert = await violation(insert({ id: selfId, parentId: selfId }));
  expect(['trigger', 'check']).toContain(selfInsert?.kind);
  expect(selfInsert?.constraint).toMatch(/TASKS-I01|tasks_self_check/u);
  const selfUpdate = await violation(
    db().run(sql`update tasks set parent_id = ${loose.id} where id = ${loose.id}`),
  );
  expect(['trigger', 'check']).toContain(selfUpdate?.kind);
  expect(selfUpdate?.constraint).toMatch(/TASKS-I01|tasks_self_check/u);
  // A plain second child is depth one and goes through.
  await expect(insert({ parentId: parent.id, sortOrder: 5 })).resolves.toBeTruthy();
});
it('TASKS-I05 sort_order is unique within a parent among live rows, and a trashed row frees its slot', async () => {
  const parent = await harness.task('Parent');
  const first = await harness.task('First', { parentId: parent.id });
  expect(
    await violation(insert({ parentId: parent.id, sortOrder: first.sortOrder })),
  ).toMatchObject({ kind: 'unique' });
  // Two roots cannot share a position either: the index coalesces the null parent.
  expect(await violation(insert({ parentId: null, sortOrder: parent.sortOrder }))).toMatchObject({
    kind: 'unique',
  });
  await db().run(
    sql`update tasks set deleted_at = ${Date.now()}, deleted_op_id = ${id()} where id = ${first.id}`,
  );
  await expect(insert({ parentId: parent.id, sortOrder: first.sortOrder })).resolves.toBeTruthy();
});
it('TASKS-I06 TASKS-B10 TASKS-B16 the parent, committee, owner and source note keys must exist and are nulled on purge', async () => {
  const unknown = id();
  for (const column of ['parentId', 'committeeId', 'ownerId', 'sourceNoteId'] as const)
    expect(await violation(insert({ [column]: unknown }))).toMatchObject({ kind: 'foreign_key' });
  const committee = await harness.committee('Finance');
  const owner = await harness.person('Leila Haddad');
  const note = await harness.note('Minutes');
  const parent = await harness.task('Parent');
  const task = await harness.task('Linked', {
    committeeId: committee.id,
    ownerId: owner.id,
    sourceNoteId: note.id,
    parentId: parent.id,
  });
  // Soft deletion of a target leaves the link in place: the chip reads "archived" or "trashed".
  await db().run(sql`update committees set deleted_at = ${Date.now()} where id = ${committee.id}`);
  const kept = await db().get<{ committee_id: string | null }>(
    sql`select committee_id from tasks where id = ${task.id}`,
  );
  expect(kept?.committee_id).toBe(committee.id);
  // A purge (hard delete) of each target nulls the column rather than orphaning or cascading.
  await db().run(sql`delete from committees where id = ${committee.id}`);
  await db().run(sql`delete from people where id = ${owner.id}`);
  await db().run(sql`delete from notes where id = ${note.id}`);
  await db().run(sql`delete from tasks where id = ${parent.id}`);
  const row = await db().get<{
    committee_id: string | null;
    owner_id: string | null;
    source_note_id: string | null;
    parent_id: string | null;
  }>(
    sql`select committee_id, owner_id, source_note_id, parent_id from tasks where id = ${task.id}`,
  );
  expect(row).toEqual({
    committee_id: null,
    owner_id: null,
    source_note_id: null,
    parent_id: null,
  });
});
it('TASKS-B02 a completion operation records a known previous status and marks undone with a timestamp', async () => {
  const task = await harness.task('Done');
  const completionId = id();
  await db().run(
    sql`insert into task_completions (id, root_task_id) values (${completionId}, ${task.id})`,
  );
  const item = (status: string) =>
    db().run(
      sql`insert into task_completion_items (completion_id, task_id, previous_status, completed_revision)
        values (${completionId}, ${task.id}, ${status}, 2)`,
    );
  expect(await violation(item('archived'))).toMatchObject({
    kind: 'check',
    constraint: 'task_completion_items_status_check',
  });
  await expect(item('waiting_on')).resolves.toBeTruthy();
  // One item per task per operation.
  expect(await violation(item('inbox'))).toMatchObject({ kind: 'unique' });
  expect(
    await violation(
      db().run(sql`update task_completions set status = 'undone' where id = ${completionId}`),
    ),
  ).toMatchObject({ kind: 'check', constraint: 'task_completions_undone_check' });
  expect(
    await violation(
      db().run(sql`update task_completions set status = 'reverted' where id = ${completionId}`),
    ),
  ).toMatchObject({ kind: 'check', constraint: 'task_completions_status_check' });
  await expect(
    db().run(
      sql`update task_completions set status = 'undone', undone_at = ${Date.now()} where id = ${completionId}`,
    ),
  ).resolves.toBeTruthy();
  // The operation belongs to its root task and goes with it.
  expect(
    await violation(
      db().run(sql`insert into task_completions (id, root_task_id) values (${id()}, ${id()})`),
    ),
  ).toMatchObject({ kind: 'foreign_key' });
  await db().run(sql`delete from tasks where id = ${task.id}`);
  const left = await db().get<{ count: number }>(
    sql`select (select count(*) from task_completions) + (select count(*) from task_completion_items) as count`,
  );
  expect(left?.count).toBe(0);
});
