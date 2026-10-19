import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import type { User } from '@/core/http/user-schema';
import * as api from '../api';
import { harness } from './fixtures';
// The route handlers run against the real database; only the cookie session and the server-side
// translator are stood in for, since neither exists outside a Next request.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', () => ({ currentUser: async () => session.user }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await harness.reset();
  session.user = harness.user;
});
afterAll(() => closeDatabase());
type Meta = { guard: string; status: number; idempotent: boolean };
const meta = (handler: { meta: Meta }) => ({
  guard: handler.meta.guard,
  status: handler.meta.status,
  idempotent: handler.meta.idempotent,
});
type Call = {
  body?: object;
  params?: Record<string, string>;
  key?: string | null;
  origin?: string;
  query?: Record<string, string>;
};
type Handler = (
  request: Request,
  route?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
// A request the way the browser client sends it: same origin, the custom header, a JSON body and
// an Idempotency-Key for the routes that store a replay.
function call(handler: Handler, method: string, path: string, options: Call = {}) {
  const url = new URL(`/api/v1${path}`, env().APP_URL);
  for (const [name, value] of Object.entries(options.query ?? {}))
    url.searchParams.set(name, value);
  const headers: Record<string, string> = {
    Origin: options.origin ?? env().APP_URL,
    'X-Requested-With': 'ExecutiveOS',
    'Content-Type': 'application/json',
  };
  if (options.key !== null) headers['Idempotency-Key'] = options.key ?? id();
  const request = new Request(url, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return handler(request, { params: Promise.resolve(options.params ?? {}) });
}
const json = async (response: Response) => {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};
it('TASKS-B01 TASKS-B02 TASKS-B08 TASKS-B09 TASKS-B11 TASKS-B13 every task endpoint is session guarded and every state-creating write is idempotent', () => {
  expect(meta(api.list)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.detail)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.create)).toEqual({ guard: 'session', status: 201, idempotent: true });
  expect(meta(api.patch)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.remove)).toEqual({ guard: 'session', status: 204, idempotent: false });
  expect(meta(api.restore)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.complete)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.undoComplete)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.reopen)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.convert)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.move)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.group)).toEqual({ guard: 'session', status: 201, idempotent: true });
  expect(meta(api.reorder)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.breakdown)).toEqual({ guard: 'session', status: 202, idempotent: false });
  expect(api.breakdown.meta.enqueues).toBe(true);
  expect(meta(api.breakdownApply)).toEqual({ guard: 'session', status: 200, idempotent: true });
});
it('TASKS-B01 TASKS-A01 a create answers 201 with the entity envelope and the row then lists under Inbox with its counts', async () => {
  const created = await call(api.create, 'POST', '/tasks', { body: { title: 'Read the pack' } });
  expect(created.status).toBe(201);
  expect(created.headers.get('X-Request-Id')).toBeTruthy();
  expect(created.headers.get('Cache-Control')).toBe('no-store');
  const body = await json(created);
  expect(Object.keys(body)).toEqual(['data']);
  expect(body.data).toMatchObject({
    title: 'Read the pack',
    status: 'inbox',
    priority: null,
    ownerId: null,
    dueDate: null,
    revision: 1,
    subtasks: [],
    band: 'nodate',
  });
  // Absent values are null, never omitted (docs/04 § Response envelopes).
  expect(body.data).toHaveProperty('description', null);
  expect(body.data).toHaveProperty('committee', null);
  const listed = await call(api.list, 'GET', '/tasks', { query: { view: 'inbox' } });
  expect(listed.status).toBe(200);
  const list = await json(listed);
  expect(list.data.map((row: { id: string }) => row.id)).toEqual([body.data.id]);
  expect(list.meta.counts).toMatchObject({ inbox: 1, all: 1, trash: 0 });
  expect(list.meta).not.toHaveProperty('total');
  expect(list.meta).toMatchObject({ nextCursor: null, defaultView: 'next' });
  expect(typeof list.meta.today).toBe('string');
});
it('TASKS-B01 TASKS-B09 validation failures name the field with a dotted path and keep the database untouched', async () => {
  const blank = await call(api.create, 'POST', '/tasks', { body: { title: '  ' } });
  expect(blank.status).toBe(400);
  const error = (await json(blank)).error;
  expect(error).toMatchObject({ code: 'validation_failed', message: 'validation_failed' });
  expect(Object.keys(error.details.fieldErrors)).toEqual(['title']);
  expect(typeof error.requestId).toBe('string');
  const nested = await call(api.group, 'POST', '/tasks/group', {
    body: { title: 'Pack', childIds: [id(), 'not-an-id'] },
  });
  expect(nested.status).toBe(400);
  expect(Object.keys((await json(nested)).error.details.fieldErrors)).toEqual(['childIds.1']);
  const unknown = await call(api.list, 'GET', '/tasks', { query: { view: 'all', made_up: '1' } });
  expect(unknown.status).toBe(400);
  const malformed = await call(api.create, 'POST', '/tasks', { body: { title: 'x', links: [] } });
  expect(malformed.status).toBe(400);
  expect((await json(await call(api.list, 'GET', '/tasks'))).meta.counts.all).toBe(0);
});
it('TASKS-B12 a write without a session is 401 and one from another origin is 403, before anything is read', async () => {
  session.user = null;
  expect((await call(api.list, 'GET', '/tasks')).status).toBe(401);
  const anonymous = await call(api.create, 'POST', '/tasks', { body: { title: 'x' } });
  expect(anonymous.status).toBe(401);
  expect((await json(anonymous)).error.code).toBe('unauthenticated');
  session.user = harness.user;
  const foreign = await call(api.create, 'POST', '/tasks', {
    body: { title: 'x' },
    origin: 'https://untrusted.example.test',
  });
  expect(foreign.status).toBe(403);
  expect((await json(foreign)).error).toMatchObject({
    code: 'forbidden',
    details: { reason: 'origin' },
  });
  // Reads do not carry an origin check; writes without the idempotency key are refused as input.
  const noKey = await call(api.create, 'POST', '/tasks', { body: { title: 'x' }, key: null });
  expect(noKey.status).toBe(400);
  expect((await json(await call(api.list, 'GET', '/tasks'))).meta.counts.all).toBe(0);
});
it('TASKS-B11 TASKS-A04 a delete answers 204 with the operation id in a header, the row then reads 404 until restored by that id', async () => {
  const task = await harness.task('Disposable');
  const removed = await call(api.remove, 'DELETE', `/tasks/${task.id}`, {
    body: { revision: task.revision },
    params: { id: task.id },
  });
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe('');
  const opId = removed.headers.get('X-Op-Id');
  expect(opId).toMatch(/^[0-9a-f-]{36}$/u);
  const gone = await call(api.detail, 'GET', `/tasks/${task.id}`, { params: { id: task.id } });
  expect(gone.status).toBe(404);
  expect((await json(gone)).error).toMatchObject({
    code: 'not_found',
    details: { entityType: 'task' },
  });
  // Every mutation on a trashed id is a 404 too, not a silent write.
  const patched = await call(api.patch, 'PATCH', `/tasks/${task.id}`, {
    body: { revision: task.revision + 1, title: 'Ghost' },
    params: { id: task.id },
  });
  expect(patched.status).toBe(404);
  const inTrash = await call(api.detail, 'GET', `/tasks/${task.id}`, {
    params: { id: task.id },
    query: { includeDeleted: 'true' },
  });
  expect((await json(inTrash)).data.deletedOpId).toBe(opId);
  const wrongOp = await call(api.restore, 'POST', `/tasks/${task.id}/restore`, {
    body: { opId: id() },
    params: { id: task.id },
  });
  expect(wrongOp.status).toBe(409);
  expect((await json(wrongOp)).error.details).toMatchObject({ reason: 'state' });
  const restored = await call(api.restore, 'POST', `/tasks/${task.id}/restore`, {
    body: { opId },
    params: { id: task.id },
  });
  expect(restored.status).toBe(200);
  expect((await json(restored)).data).toMatchObject({ id: task.id, deletedAt: null });
});
it('TASKS-B12 TASKS-A09 a stale revision answers 409 with the current row so the editor can reapply', async () => {
  const task = await harness.task('Shared');
  const first = await call(api.patch, 'PATCH', `/tasks/${task.id}`, {
    body: { revision: 1, title: 'First edit' },
    params: { id: task.id },
  });
  expect(first.status).toBe(200);
  expect((await json(first)).data.revision).toBe(2);
  const stale = await call(api.patch, 'PATCH', `/tasks/${task.id}`, {
    body: { revision: 1, title: 'Second edit' },
    params: { id: task.id },
  });
  expect(stale.status).toBe(409);
  const error = (await json(stale)).error;
  expect(error.code).toBe('conflict');
  expect(error.details.reason).toBe('revision');
  expect(error.details.current).toMatchObject({ id: task.id, title: 'First edit', revision: 2 });
  for (const [handler, action, body] of [
    [api.complete, 'complete', { revision: 1 }],
    [api.reopen, 'reopen', { revision: 1 }],
    [api.convert, 'convert-to-task', { revision: 1 }],
  ] as const) {
    const response = await call(handler, 'POST', `/tasks/${task.id}/${action}`, {
      body,
      params: { id: task.id },
    });
    expect([action, response.status]).toEqual([action, 409]);
  }
});
it('TASKS-B01 a replayed Idempotency-Key returns the stored response once, and a different payload under the same key is a duplicate', async () => {
  const key = id();
  const first = await call(api.create, 'POST', '/tasks', { body: { title: 'Once' }, key });
  const second = await call(api.create, 'POST', '/tasks', { body: { title: 'Once' }, key });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(await json(second)).toEqual(await json(first));
  const conflict = await call(api.create, 'POST', '/tasks', { body: { title: 'Twice' }, key });
  expect(conflict.status).toBe(409);
  expect((await json(conflict)).error.details).toEqual({ reason: 'duplicate' });
  const list = await json(await call(api.list, 'GET', '/tasks'));
  expect(list.data.map((row: { title: string }) => row.title)).toEqual(['Once']);
});
it('TASKS-B02 TASKS-A03 completing is an action route that answers the operation id, refuses open children without force, and PATCH cannot reach completed', async () => {
  const parent = await harness.task('Parent');
  const child = await harness.task('Child', { parentId: parent.id });
  const viaPatch = await call(api.patch, 'PATCH', `/tasks/${parent.id}`, {
    body: { revision: 1, status: 'completed' },
    params: { id: parent.id },
  });
  expect(viaPatch.status).toBe(422);
  expect((await json(viaPatch)).error.details).toEqual({ rule: 'TASKS-B02' });
  const refused = await call(api.complete, 'POST', `/tasks/${parent.id}/complete`, {
    body: { revision: 1 },
    params: { id: parent.id },
  });
  expect(refused.status).toBe(409);
  expect((await json(refused)).error.details).toEqual({ reason: 'state', openSubtasks: 1 });
  const forced = await call(api.complete, 'POST', `/tasks/${parent.id}/complete`, {
    body: { revision: 1, force: true },
    params: { id: parent.id },
  });
  expect(forced.status).toBe(200);
  const body = await json(forced);
  expect(Object.keys(body).sort()).toEqual(['data', 'meta']);
  expect(body.data.status).toBe('completed');
  expect(body.data.subtasks.map((row: { id: string; status: string }) => row.status)).toEqual([
    'completed',
  ]);
  expect(body.meta.opId).toMatch(/^[0-9a-f-]{36}$/u);
  const undone = await call(api.undoComplete, 'POST', `/tasks/${parent.id}/complete/undo`, {
    body: { opId: body.meta.opId },
    params: { id: parent.id },
  });
  expect(undone.status).toBe(200);
  const after = (await json(undone)).data;
  expect(after.status).toBe('inbox');
  expect(after.subtasks.find((row: { id: string }) => row.id === child.id).status).toBe('inbox');
});
it('TASKS-B08 TASKS-B09 TASKS-I05 group, make-subtask, convert and reorder answer the parent and refuse the depth rule as 422', async () => {
  const one = await harness.task('One');
  const two = await harness.task('Two');
  const grouped = await call(api.group, 'POST', '/tasks/group', {
    body: { title: 'Pack', childIds: [one.id, two.id] },
  });
  expect(grouped.status).toBe(201);
  const parent = (await json(grouped)).data;
  expect(parent.subtasks.map((row: { id: string }) => row.id)).toEqual([one.id, two.id]);
  // A parent cannot be grouped again: the response names the offending id.
  const other = await harness.task('Other');
  const refused = await call(api.group, 'POST', '/tasks/group', {
    body: { title: 'Nested', childIds: [parent.id, other.id] },
  });
  expect(refused.status).toBe(422);
  expect((await json(refused)).error.details).toEqual({ rule: 'TASKS-B09', ids: [parent.id] });
  const under = await call(api.move, 'POST', `/tasks/${other.id}/make-subtask`, {
    body: { revision: other.revision, parentId: one.id },
    params: { id: other.id },
  });
  expect(under.status).toBe(422);
  expect((await json(under)).error.details).toEqual({ rule: 'TASKS-I01' });
  const moved = await call(api.move, 'POST', `/tasks/${other.id}/make-subtask`, {
    body: { revision: other.revision, parentId: parent.id },
    params: { id: other.id },
  });
  expect(moved.status).toBe(200);
  expect((await json(moved)).data.parentId).toBe(parent.id);
  const detail = (
    await json(await call(api.detail, 'GET', `/tasks/${parent.id}`, { params: { id: parent.id } }))
  ).data;
  const orderedIds = detail.subtasks.map((row: { id: string }) => row.id).reverse();
  const revisions = Object.fromEntries(
    detail.subtasks.map((row: { id: string; revision: number }) => [row.id, row.revision]),
  );
  const reordered = await call(api.reorder, 'PATCH', '/tasks/reorder', {
    body: { parentId: parent.id, orderedIds, revisions },
  });
  expect(reordered.status).toBe(200);
  expect((await json(reordered)).data.subtasks.map((row: { id: string }) => row.id)).toEqual(
    orderedIds,
  );
  const converted = await call(api.convert, 'POST', `/tasks/${one.id}/convert-to-task`, {
    body: { revision: revisions[one.id] + 1 },
    params: { id: one.id },
  });
  expect(converted.status).toBe(200);
  expect((await json(converted)).data.parentId).toBeNull();
});
it('TASKS-B16 TASKS-B05 the list carries meta.total only on request and the detail embeds the source note', async () => {
  const note = await harness.note('Minutes');
  const task = await harness.task('From the minutes', { sourceNoteId: note.id });
  const withTotal = await json(
    await call(api.list, 'GET', '/tasks', {
      query: { view: 'all', withTotal: 'true', sourceNoteId: note.id },
    }),
  );
  expect(withTotal.meta.total).toBe(1);
  expect(withTotal.data[0].sourceNote).toMatchObject({ id: note.id, title: 'Minutes' });
  const detail = await json(
    await call(api.detail, 'GET', `/tasks/${task.id}`, { params: { id: task.id } }),
  );
  expect(detail.data.sourceNote).toEqual({
    id: note.id,
    title: 'Minutes',
    deletedAt: null,
    archivedAt: null,
  });
  const detached = await call(api.patch, 'PATCH', `/tasks/${task.id}`, {
    body: { revision: 1, sourceNoteId: null },
    params: { id: task.id },
  });
  expect((await json(detached)).data.sourceNote).toBeNull();
  const missing = await call(api.patch, 'PATCH', `/tasks/${task.id}`, {
    body: { revision: 2, sourceNoteId: id() },
    params: { id: task.id },
  });
  expect(missing.status).toBe(404);
});
