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
  userId: string | null;
  kind?: string;
  subjectId?: string;
  actorId?: string | null;
  readAt?: number | null;
};
const insert = (row: Row) =>
  db().run(
    sql`insert into notifications (id, user_id, kind, subject_type, subject_id, actor_id, read_at) values (${id()}, ${row.userId}, ${row.kind ?? 'task.assigned'}, 'tasks', ${row.subjectId ?? id()}, ${row.actorId ?? null}, ${row.readAt ?? null})`,
  );
const count = async (where = sql`1 = 1`) =>
  (
    await db().get<{ count: number }>(
      sql`select count(*) as count from notifications where ${where}`,
    )
  )?.count ?? -1;
const users = () => {
  const { actor, member } = harness;
  if (!actor || !member) throw new Error('harness');
  return { actor, member };
};
it('NOTIF-I01 a row is addressed to exactly one existing user', async () => {
  const { member } = users();
  await expect(insert({ userId: member.id })).resolves.toBeTruthy();
  expect(await violation(insert({ userId: null }))).toMatchObject({
    kind: 'not_null',
    columns: ['notifications.user_id'],
  });
  expect(await violation(insert({ userId: id() }))).toMatchObject({ kind: 'foreign_key' });
});
it('NOTIF-I03 the database refuses a kind no module declares', async () => {
  const { member } = users();
  expect(await violation(insert({ userId: member.id, kind: 'task.commented' }))).toMatchObject({
    kind: 'check',
    constraint: 'notifications_kind_check',
  });
  // Every declared kind is admitted, including the two the clock emits with no actor.
  for (const kind of [
    'task.due_today',
    'task.overdue',
    'note.mentioned',
    'kpi.off_target',
    'job.finished',
  ])
    await expect(insert({ userId: member.id, kind })).resolves.toBeTruthy();
});
it('NOTIF-I02 the database keeps one unread row per reader, kind and subject, and frees it once read', async () => {
  const { actor, member } = users();
  const subjectId = id();
  await expect(insert({ userId: member.id, subjectId })).resolves.toBeTruthy();
  expect(await violation(insert({ userId: member.id, subjectId }))).toMatchObject({
    kind: 'unique',
    columns: ['notifications.user_id', 'notifications.kind', 'notifications.subject_id'],
  });
  // A different kind about the same subject, or the same kind for another reader, is its own row.
  await expect(
    insert({ userId: member.id, subjectId, kind: 'task.overdue' }),
  ).resolves.toBeTruthy();
  await expect(insert({ userId: actor.id, subjectId })).resolves.toBeTruthy();
  // The index is partial: once the first is read the subject is news again (NOTIF-B03).
  await db().run(
    sql`update notifications set read_at = ${Date.now()} where user_id = ${member.id} and kind = 'task.assigned'`,
  );
  await expect(insert({ userId: member.id, subjectId })).resolves.toBeTruthy();
  await expect(insert({ userId: member.id, subjectId, readAt: Date.now() })).resolves.toBeTruthy();
  expect(await count(sql`user_id = ${member.id} and kind = 'task.assigned'`)).toBe(3);
});
it('NOTIF-B13 deleting a user cascades their rows and detaches them as an actor elsewhere', async () => {
  const { actor, member } = users();
  await insert({ userId: member.id, actorId: actor.id });
  await insert({ userId: actor.id, actorId: member.id });
  expect(await violation(insert({ userId: member.id, actorId: id() }))).toMatchObject({
    kind: 'foreign_key',
  });
  await db().run(sql`delete from users where id = ${actor.id}`);
  expect(await count(sql`user_id = ${actor.id}`)).toBe(0);
  // The member's row survives: it is addressed to them, and only its actor is gone.
  const kept = await db().get<{ actor_id: string | null }>(
    sql`select actor_id from notifications where user_id = ${member.id}`,
  );
  expect(kept).toEqual({ actor_id: null });
});
