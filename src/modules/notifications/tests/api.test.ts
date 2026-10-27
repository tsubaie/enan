import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import type { User } from '@/core/http/user-schema';
import { notifications } from '@/core/db/system-schema';
import { tasks } from '@/modules/tasks/schema/db';
import { patchTask, removeTask, restoreTask } from '@/modules/tasks/service';
import { TaskPatch } from '@/modules/tasks/schema/validation';
import * as api from '../api';
import { harness } from './fixtures';
// The handler asks the session who is reading (NOTIF-I04); here that answer is whichever account
// the scenario has signed in, or nobody.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', () => ({ currentUser: async () => session.user }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  session.user = null;
  await harness.reset();
});
afterAll(() => closeDatabase());
type Meta = { guard: string; status: number; idempotent: boolean };
const meta = (handler: { meta: Meta }) => ({
  guard: handler.meta.guard,
  status: handler.meta.status,
  idempotent: handler.meta.idempotent,
});
const users = () => {
  const { actor, member } = harness;
  if (!actor || !member) throw new Error('harness');
  return { actor, member };
};
type Write = {
  key?: string | null;
  origin?: string;
  requestedWith?: string | null;
  body?: string;
};
function get(query = '') {
  return new Request(new URL(`/api/v1/notifications${query}`, env().APP_URL), { method: 'GET' });
}
function post(path: string, options: Write = {}) {
  const headers = new Headers({
    Origin: options.origin ?? env().APP_URL,
    'Content-Type': 'application/json',
  });
  if (options.requestedWith !== null)
    headers.set('X-Requested-With', options.requestedWith ?? 'Enan');
  if (options.key !== null) headers.set('Idempotency-Key', options.key ?? crypto.randomUUID());
  return new Request(new URL(`/api/v1/notifications${path}`, env().APP_URL), {
    method: 'POST',
    headers,
    body: options.body ?? '{}',
  });
}
async function answer(response: Response) {
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const feedAs = (user: User | null, query = '') => {
  session.user = user;
  return api.feed(get(query)).then(answer);
};
const readAs = (user: User | null, notificationId: string, options?: Write) => {
  session.user = user;
  return api
    .read(post(`/${notificationId}/read`, options), {
      params: Promise.resolve({ id: notificationId }),
    })
    .then(answer);
};
const readAllAs = (user: User | null, options?: Write) => {
  session.user = user;
  return api.readAll(post('/read-all', options)).then(answer);
};
// A task the actor gives to the member's person: the one event the module emits today.
async function assigned(title: string) {
  const { member } = users();
  const person = await harness.personFor(member, 'Receiving Member');
  const task = await harness.task(title, { ownerId: person.id });
  return { person, task };
}
async function reassign(taskId: string, ownerId: string) {
  const [current] = await harness.run((ctx) =>
    ctx.db.select().from(tasks).where(eq(tasks.id, taskId)),
  );
  const revision = current?.revision ?? 1;
  await harness.run((ctx) => patchTask(ctx, taskId, TaskPatch.parse({ revision, ownerId: null })));
  await harness.run((ctx) =>
    patchTask(ctx, taskId, TaskPatch.parse({ revision: revision + 1, ownerId })),
  );
}
const stored = () => db().select().from(notifications);
it('NOTIF-I04 NOTIF-B07 the feed is a session read and both writes are idempotent session writes', () => {
  expect(meta(api.feed)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.read)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.readAll)).toEqual({ guard: 'session', status: 200, idempotent: true });
  // NOTIF-I04: no handler takes a user id. The reader is the session.
  expect(api.feed.meta.input.safeParse({ userId: id() }).success).toBe(false);
  expect(api.read.meta.input.safeParse({ userId: id() }).success).toBe(false);
});
it('NOTIF-A01 NOTIF-B08 the recipient reads one line naming the actor and the task while the actor reads nothing', async () => {
  const { actor, member } = users();
  const { task } = await assigned('Review the board pack');
  const mine = await feedAs(member);
  expect(mine.status).toBe(200);
  expect(mine.headers.get('Cache-Control')).toBe('no-store');
  expect(mine.headers.get('X-Request-Id')).toBeTruthy();
  expect(mine.body).toEqual({
    data: {
      items: [
        expect.objectContaining({
          kind: 'task.assigned',
          subjectType: 'tasks',
          subjectId: task.id,
          title: 'Review the board pack',
          href: expect.stringContaining(task.id),
          actorName: 'Assigning Actor',
          readAt: null,
        }),
      ],
      unread: 1,
      totalCount: 1,
      nextCursor: null,
    },
  });
  const theirs = await feedAs(actor);
  expect(theirs.body).toEqual({ data: { items: [], unread: 0, totalCount: 0, nextCursor: null } });
});
it('NOTIF-A02 NOTIF-B03 reassigning the same task twice leaves one unread line, at the top', async () => {
  const { member } = users();
  const { person, task: older } = await assigned('Older business');
  const task = await harness.task('Reassigned twice', { ownerId: person.id });
  await reassign(task.id, person.id);
  await reassign(task.id, person.id);
  const page = await feedAs(member);
  expect(page.body.data.items.map((item: { subjectId: string }) => item.subjectId)).toEqual([
    task.id,
    older.id,
  ]);
  expect(page.body.data.unread).toBe(2);
  expect((await stored()).filter((row) => row.subjectId === task.id)).toHaveLength(1);
});
it('NOTIF-B03 NOTIF-B08 the feed pages newest first and a cursor continues strictly before the page end', async () => {
  const { member } = users();
  const { person } = await assigned('First');
  await harness.task('Second', { ownerId: person.id });
  await harness.task('Third', { ownerId: person.id });
  // Three writes can land in one millisecond; the page order has to be decided by time, so the
  // rows are spread an hour apart in the order they were written.
  const rows = await stored();
  for (const [index, row] of rows.entries())
    await db()
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - (rows.length - index) * 3_600_000) })
      .where(eq(notifications.id, row.id));
  const first = await feedAs(member, '?limit=2');
  expect(first.status).toBe(200);
  expect(first.body.data.items.map((item: { title: string }) => item.title)).toEqual([
    'Third',
    'Second',
  ]);
  expect(first.body.data.unread).toBe(3);
  const end = first.body.data.items[1];
  expect(first.body.data.nextCursor).toBe(`${end.createdAt}_${end.id}`);
  const rest = await feedAs(
    member,
    `?limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
  );
  expect(rest.body.data.items.map((item: { title: string }) => item.title)).toEqual(['First']);
  expect(rest.body.data.nextCursor).toBeNull();
});
it('NOTIF-A05 NOTIF-B04 assigning a task to a person with no account writes nothing anyone can read', async () => {
  const { actor, member } = users();
  const adviser = await harness.unlinkedPerson('External Adviser');
  await harness.task('Work for someone who cannot sign in', { ownerId: adviser.id });
  expect((await feedAs(member)).body.data).toEqual({
    items: [],
    unread: 0,
    totalCount: 0,
    nextCursor: null,
  });
  expect((await feedAs(actor)).body.data).toEqual({
    items: [],
    unread: 0,
    totalCount: 0,
    nextCursor: null,
  });
  expect(await stored()).toHaveLength(0);
});
it('NOTIF-A06 NOTIF-I04 a member can neither list nor mark another member notifications', async () => {
  const { actor, member } = users();
  await assigned('Addressed to the member');
  const [row] = await stored();
  if (!row) throw new Error('no notification');
  const theirs = await feedAs(actor);
  expect(theirs.body.data.items).toEqual([]);
  const forbidden = await readAs(actor, row.id);
  expect(forbidden.status).toBe(404);
  expect(forbidden.body.error).toMatchObject({ code: 'not_found', message: 'not_found' });
  expect(typeof forbidden.body.error.requestId).toBe('string');
  expect((await stored())[0]?.readAt).toBeNull();
  const mine = await readAs(member, row.id);
  expect(mine.status).toBe(200);
  expect(mine.body).toEqual({ data: { id: row.id, readAt: expect.any(String) } });
});
it('NOTIF-B09 NOTIF-B07 opening a notification marks it read, the count follows, and the write replays on its key', async () => {
  const { member } = users();
  await assigned('Opened');
  const [row] = await stored();
  if (!row) throw new Error('no notification');
  const key = crypto.randomUUID();
  const opened = await readAs(member, row.id, { key });
  expect(opened.status).toBe(200);
  const replay = await readAs(member, row.id, { key });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(opened.body);
  const page = await feedAs(member);
  expect(page.body.data.unread).toBe(0);
  expect(page.body.data.items[0].readAt).toBe(opened.body.data.readAt);
  // The same key on a different request is a conflict, not a second mark (docs/04).
  const other = await readAs(member, id(), { key });
  expect(other.status).toBe(409);
  expect(other.body.error.code).toBe('conflict');
});
it('NOTIF-B07 mark all as read marks exactly the rows the reader could see and replays on its key', async () => {
  const { member } = users();
  const { person, task: hidden } = await assigned('Hidden');
  await harness.task('Visible', { ownerId: person.id });
  await harness.run((ctx) => removeTask(ctx, hidden.id, 1));
  const key = crypto.randomUUID();
  const marked = await readAllAs(member, { key });
  expect(marked.status).toBe(200);
  expect(marked.body).toEqual({ data: { marked: 1 } });
  expect((await readAllAs(member, { key })).body).toEqual({ data: { marked: 1 } });
  expect((await readAllAs(member)).body).toEqual({ data: { marked: 0 } });
  const rows = await stored();
  expect(rows.find((row) => row.subjectId === hidden.id)?.readAt).toBeNull();
  expect(rows.filter((row) => row.readAt !== null)).toHaveLength(1);
  const page = await feedAs(member);
  expect(page.body.data.unread).toBe(0);
  expect(page.body.data.items).toHaveLength(1);
});
it('NOTIF-B07 NOTIF-B08 a vanished subject past the first page is not counted, and mark all reaches past it', async () => {
  const { member } = users();
  const { person, task: oldest } = await assigned('Oldest');
  for (let index = 0; index < 22; index++)
    await harness.task(`Newer ${index}`, { ownerId: person.id });
  // The oldest row sits past the default page of 20; its task then goes to the trash.
  await db()
    .update(notifications)
    .set({ createdAt: new Date('2026-01-01T00:00:00.000Z') })
    .where(eq(notifications.subjectId, oldest.id));
  await harness.run((ctx) => removeTask(ctx, oldest.id, 1));
  expect((await feedAs(member)).body.data.unread).toBe(22);
  expect((await readAllAs(member)).body).toEqual({ data: { marked: 22 } });
  expect((await feedAs(member)).body.data.unread).toBe(0);
});
it('NOTIF-A04 NOTIF-B06 a trashed subject leaves the feed and the count without its row being deleted', async () => {
  const { member } = users();
  const { task } = await assigned('About to be trashed');
  expect((await feedAs(member)).body.data.unread).toBe(1);
  const { opId } = await harness.run((ctx) => removeTask(ctx, task.id, 1));
  const gone = await feedAs(member);
  expect(gone.body.data).toEqual({ items: [], unread: 0, totalCount: 0, nextCursor: null });
  expect(await stored()).toHaveLength(1);
  await harness.run((ctx) => restoreTask(ctx, task.id, opId));
  const back = await feedAs(member);
  expect(back.body.data.unread).toBe(1);
  expect(back.body.data.items[0]).toMatchObject({ subjectId: task.id, readAt: null });
});
it('NOTIF-I04 NOTIF-A06 nobody reads without a session and no write lands from another origin', async () => {
  const { member } = users();
  await assigned('Guarded');
  const [row] = await stored();
  if (!row) throw new Error('no notification');
  for (const response of [await feedAs(null), await readAs(null, row.id), await readAllAs(null)]) {
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthenticated');
  }
  const foreign = await readAllAs(member, { origin: 'https://untrusted.example.test' });
  expect(foreign.status).toBe(403);
  expect(foreign.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'origin' } });
  const plain = await readAs(member, row.id, { requestedWith: null });
  expect(plain.status).toBe(403);
  expect((await stored())[0]?.readAt).toBeNull();
});
it('NOTIF-B08 NOTIF-B07 the feed names the field it refuses and a write without its key is refused', async () => {
  const { member } = users();
  await assigned('Validated');
  const [row] = await stored();
  if (!row) throw new Error('no notification');
  for (const query of ['?limit=0', '?limit=101', '?limit=abc']) {
    const response = await feedAs(member, query);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_failed');
    expect(Object.keys(response.body.error.details.fieldErrors)).toEqual(['limit']);
  }
  expect((await feedAs(member, '?unknown=1')).status).toBe(400);
  expect((await feedAs(member, '?kind=committees')).status).toBe(400);
  expect((await feedAs(member, '?unread=yes')).status).toBe(400);
  expect((await readAllAs(member, { body: '{"kind":"committees"}' })).status).toBe(400);
  const cursor = await feedAs(member, '?cursor=not-a-time');
  expect(cursor.status).toBe(400);
  expect(cursor.body.error.code).toBe('validation_failed');
  expect((await readAs(member, 'not-a-uuid')).status).toBe(400);
  expect((await readAs(member, row.id, { key: null })).status).toBe(400);
  expect((await readAs(member, row.id, { key: 'not-a-uuid' })).status).toBe(400);
  expect((await readAs(member, row.id, { body: '{"extra":1}' })).status).toBe(400);
  expect((await readAllAs(member, { body: 'not json' })).status).toBe(400);
  expect((await stored())[0]?.readAt).toBeNull();
});
it('NOTIF-B14 NOTIF-B15 the feed narrows to unread rows and to a kind group, counting what matches', async () => {
  const { member } = users();
  const { person, task: opened } = await assigned('Opened first');
  await harness.task('Still unread', { ownerId: person.id });
  const [row] = (await stored()).filter((stored) => stored.subjectId === opened.id);
  if (!row) throw new Error('no notification');
  await readAs(member, row.id);
  const all = await feedAs(member);
  expect(all.body.data).toMatchObject({ unread: 1, totalCount: 2 });
  const unread = await feedAs(member, '?unread=1');
  expect(unread.body.data.items.map((item: { title: string }) => item.title)).toEqual([
    'Still unread',
  ]);
  expect(unread.body.data).toMatchObject({ unread: 1, totalCount: 1 });
  expect((await feedAs(member, '?kind=tasks')).body.data.totalCount).toBe(2);
  expect((await feedAs(member, '?kind=task.assigned&unread=true')).body.data.totalCount).toBe(1);
  const notes = await feedAs(member, '?kind=notes');
  // The badge still counts every unread row, whatever the page is filtered to (NOTIF-B08).
  expect(notes.body.data).toMatchObject({ items: [], unread: 1, totalCount: 0 });
  // NOTIF-B07: mark all on a filtered page marks only that filter's rows.
  expect((await readAllAs(member, { body: '{"kind":"notes"}' })).body.data.marked).toBe(0);
  expect((await readAllAs(member, { body: '{"kind":"tasks"}' })).body.data.marked).toBe(1);
  expect((await feedAs(member)).body.data.unread).toBe(0);
});
