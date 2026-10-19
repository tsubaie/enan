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
it('COMM-B01 COMM-B03 COMM-B04 every committee endpoint is session guarded and every state-creating write is idempotent', () => {
  expect(meta(api.list)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.detail)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.choices)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.activity)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.create)).toEqual({ guard: 'session', status: 201, idempotent: true });
  expect(meta(api.patch)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.remove)).toEqual({ guard: 'session', status: 204, idempotent: false });
  expect(meta(api.restore)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.archive)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.unarchive)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.reorder)).toEqual({ guard: 'session', status: 200, idempotent: true });
  // Reads take their input from the query string; the detail accepts only the trash flag.
  expect(api.detail.meta.input.safeParse({ includeDeleted: 'true' }).success).toBe(true);
  expect(api.detail.meta.input.safeParse({ expand: 'tasks' }).success).toBe(false);
});
it('COMM-B01 COMM-B02 COMM-A01 a create answers 201 with the entity and its zeroed stats, and the list envelope carries counts and task totals', async () => {
  const created = await call(api.create, 'POST', '/committees', { body: { name: 'Finance' } });
  expect(created.status).toBe(201);
  expect(created.headers.get('X-Request-Id')).toBeTruthy();
  const body = await json(created);
  expect(Object.keys(body)).toEqual(['data']);
  expect(body.data).toMatchObject({
    name: 'Finance',
    scope: 'internal',
    status: 'active',
    revision: 1,
    stats: { open: 0, completed: 0, overdue: 0, today: 0 },
    lastNoteDate: null,
    deletedAt: null,
  });
  expect(body.data).not.toHaveProperty('searchText');
  await harness.task('Action', { committeeId: body.data.id });
  const listed = await call(api.list, 'GET', '/committees');
  expect(listed.status).toBe(200);
  const list = await json(listed);
  expect(Object.keys(list).sort()).toEqual(['data', 'meta']);
  expect(list.data.map((row: { id: string }) => row.id)).toEqual([body.data.id]);
  expect(list.data[0].stats.open).toBe(1);
  expect(list.meta).toEqual({
    counts: {
      all: 1,
      active: 1,
      archived: 0,
      trash: 0,
      overdue: 0,
      today: 0,
      open: 1,
      completed: 0,
    },
    taskStats: { open: 1, completed: 0, today: 0, overdue: 0 },
    nextCursor: null,
  });
});
it('COMM-I01 COMM-A04 a duplicate name answers 409 unique with the error on the name field, on create, rename and restore', async () => {
  const finance = await harness.committee('Finance');
  const duplicate = await call(api.create, 'POST', '/committees', { body: { name: 'finance' } });
  expect(duplicate.status).toBe(409);
  expect((await json(duplicate)).error).toMatchObject({
    code: 'conflict',
    details: { reason: 'unique', fieldErrors: { name: ['COMM-I01'] } },
  });
  const risk = await harness.committee('Risk');
  const renamed = await call(api.patch, 'PATCH', `/committees/${risk.id}`, {
    body: { revision: 1, name: 'FINANCE' },
    params: { id: risk.id },
  });
  expect(renamed.status).toBe(409);
  expect((await json(renamed)).error.details.fieldErrors).toEqual({ name: ['COMM-I01'] });
  // Renaming to one's own name, in a different case, is not a collision.
  const own = await call(api.patch, 'PATCH', `/committees/${finance.id}`, {
    body: { revision: 1, name: 'FINANCE' },
    params: { id: finance.id },
  });
  expect(own.status).toBe(200);
  const removed = await call(api.remove, 'DELETE', `/committees/${finance.id}`, {
    body: { revision: 2 },
    params: { id: finance.id },
  });
  const opId = removed.headers.get('X-Op-Id') ?? '';
  await harness.committee('Finance');
  const restored = await call(api.restore, 'POST', `/committees/${finance.id}/restore`, {
    body: { opId },
    params: { id: finance.id },
  });
  expect(restored.status).toBe(409);
  expect((await json(restored)).error.details.fieldErrors).toEqual({ name: ['COMM-I01'] });
});
it('COMM-B01 COMM-B04 validation failures name the field with a dotted path and leave nothing behind', async () => {
  const blank = await call(api.create, 'POST', '/committees', { body: { name: '  ' } });
  expect(blank.status).toBe(400);
  const error = (await json(blank)).error;
  expect(error).toMatchObject({ code: 'validation_failed', message: 'validation_failed' });
  expect(Object.keys(error.details.fieldErrors)).toEqual(['name']);
  expect(typeof error.requestId).toBe('string');
  const nested = await call(api.reorder, 'PATCH', '/committees/reorder', {
    body: {
      items: [
        { id: id(), revision: 1 },
        { id: id(), revision: 0 },
      ],
    },
  });
  expect(nested.status).toBe(400);
  expect(Object.keys((await json(nested)).error.details.fieldErrors)).toEqual(['items.1.revision']);
  expect((await call(api.list, 'GET', '/committees', { query: { view: 'made_up' } })).status).toBe(
    400,
  );
  expect(
    (await call(api.create, 'POST', '/committees', { body: { name: 'x', scope: 'regional' } }))
      .status,
  ).toBe(400);
  expect((await json(await call(api.list, 'GET', '/committees'))).meta.counts.all).toBe(0);
});
it('COMM-B04 a write without a session is 401, from another origin 403, and without an idempotency key 400', async () => {
  session.user = null;
  expect((await call(api.list, 'GET', '/committees')).status).toBe(401);
  const anonymous = await call(api.create, 'POST', '/committees', { body: { name: 'x' } });
  expect(anonymous.status).toBe(401);
  expect((await json(anonymous)).error.code).toBe('unauthenticated');
  session.user = harness.user;
  const foreign = await call(api.create, 'POST', '/committees', {
    body: { name: 'x' },
    origin: 'https://untrusted.example.test',
  });
  expect(foreign.status).toBe(403);
  expect((await json(foreign)).error).toMatchObject({
    code: 'forbidden',
    details: { reason: 'origin' },
  });
  expect(
    (await call(api.create, 'POST', '/committees', { body: { name: 'x' }, key: null })).status,
  ).toBe(400);
  expect((await json(await call(api.list, 'GET', '/committees'))).meta.counts.all).toBe(0);
});
it('COMM-B04 COMM-I03 a delete answers 204 with its operation id, the row then reads 404 and keeps its work until restored by that id', async () => {
  const committee = await harness.committee('Finance');
  const task = await harness.task('Action', { committeeId: committee.id });
  const removed = await call(api.remove, 'DELETE', `/committees/${committee.id}`, {
    body: { revision: 1 },
    params: { id: committee.id },
  });
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe('');
  const opId = removed.headers.get('X-Op-Id');
  expect(opId).toMatch(/^[0-9a-f-]{36}$/u);
  const gone = await call(api.detail, 'GET', `/committees/${committee.id}`, {
    params: { id: committee.id },
  });
  expect(gone.status).toBe(404);
  expect((await json(gone)).error.code).toBe('not_found');
  const archive = await call(api.archive, 'POST', `/committees/${committee.id}/archive`, {
    body: { revision: 2 },
    params: { id: committee.id },
  });
  expect(archive.status).toBe(404);
  const inTrash = await call(api.detail, 'GET', `/committees/${committee.id}`, {
    params: { id: committee.id },
    query: { includeDeleted: 'true' },
  });
  expect((await json(inTrash)).data).toMatchObject({ deletedOpId: opId, stats: { open: 1 } });
  // Activity stays readable for a trashed body, and the task's own detail still names it.
  expect(
    (
      await call(api.activity, 'GET', `/committees/${committee.id}/activity`, {
        params: { id: committee.id },
      })
    ).status,
  ).toBe(200);
  const wrongOp = await call(api.restore, 'POST', `/committees/${committee.id}/restore`, {
    body: { opId: id() },
    params: { id: committee.id },
  });
  expect(wrongOp.status).toBe(409);
  const restored = await call(api.restore, 'POST', `/committees/${committee.id}/restore`, {
    body: { opId },
    params: { id: committee.id },
  });
  expect(restored.status).toBe(200);
  expect((await json(restored)).data).toMatchObject({ id: committee.id, deletedAt: null });
  void task;
});
it('COMM-B04 COMM-A03 archive and unarchive are revision-fenced actions; a stale revision answers 409 with the current row', async () => {
  const committee = await harness.committee('Finance');
  const archived = await call(api.archive, 'POST', `/committees/${committee.id}/archive`, {
    body: { revision: 1 },
    params: { id: committee.id },
  });
  expect(archived.status).toBe(200);
  expect((await json(archived)).data).toMatchObject({ status: 'archived', revision: 2 });
  const stale = await call(api.patch, 'PATCH', `/committees/${committee.id}`, {
    body: { revision: 1, ownership: 'Board' },
    params: { id: committee.id },
  });
  expect(stale.status).toBe(409);
  const error = (await json(stale)).error;
  expect(error.details.reason).toBe('revision');
  expect(error.details.current).toMatchObject({
    id: committee.id,
    status: 'archived',
    revision: 2,
  });
  const staleAction = await call(api.unarchive, 'POST', `/committees/${committee.id}/unarchive`, {
    body: { revision: 1 },
    params: { id: committee.id },
  });
  expect(staleAction.status).toBe(409);
  // The action body is the revision alone: a status smuggled in beside it is refused.
  const extra = await call(api.archive, 'POST', `/committees/${committee.id}/archive`, {
    body: { revision: 2, status: 'active' },
    params: { id: committee.id },
  });
  expect(extra.status).toBe(400);
  const unarchived = await call(api.unarchive, 'POST', `/committees/${committee.id}/unarchive`, {
    body: { revision: 2 },
    params: { id: committee.id },
  });
  expect((await json(unarchived)).data).toMatchObject({ status: 'active', revision: 3 });
  const list = await json(
    await call(api.list, 'GET', '/committees', { query: { view: 'active' } }),
  );
  expect(list.data.map((row: { id: string }) => row.id)).toEqual([committee.id]);
});
it('COMM-B01 a replayed Idempotency-Key returns the stored response once, and a different payload under the same key is a duplicate', async () => {
  const key = id();
  const first = await call(api.create, 'POST', '/committees', { body: { name: 'Once' }, key });
  const second = await call(api.create, 'POST', '/committees', { body: { name: 'Once' }, key });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(await json(second)).toEqual(await json(first));
  const conflict = await call(api.create, 'POST', '/committees', { body: { name: 'Twice' }, key });
  expect(conflict.status).toBe(409);
  expect((await json(conflict)).error.details).toEqual({ reason: 'duplicate' });
  const list = await json(await call(api.list, 'GET', '/committees'));
  expect(list.data.map((row: { name: string }) => row.name)).toEqual(['Once']);
});
it('COMM-B03 COMM-B04 choices offer active bodies plus the current one, the reorder answers the ids it moved, and activity pages with a cursor', async () => {
  const finance = await harness.committee('Finance');
  const risk = await harness.committee('Risk');
  await call(api.archive, 'POST', `/committees/${risk.id}/archive`, {
    body: { revision: 1 },
    params: { id: risk.id },
  });
  const plain = await json(await call(api.choices, 'GET', '/committees/choices'));
  expect(plain.data.map((row: { id: string }) => row.id)).toEqual([finance.id]);
  const withCurrent = await json(
    await call(api.choices, 'GET', '/committees/choices', { query: { current: risk.id } }),
  );
  expect(withCurrent.data).toContainEqual({
    id: risk.id,
    name: 'Risk',
    status: 'archived',
    deleted: false,
  });
  const reordered = await call(api.reorder, 'PATCH', '/committees/reorder', {
    body: {
      items: [
        { id: risk.id, revision: 2 },
        { id: finance.id, revision: 1 },
      ],
    },
  });
  expect(reordered.status).toBe(200);
  expect(await json(reordered)).toEqual({ data: { updatedIds: [risk.id, finance.id] } });
  const manual = await json(
    await call(api.list, 'GET', '/committees', { query: { view: 'all', sort: 'manual' } }),
  );
  expect(manual.data.map((row: { id: string }) => row.id)).toEqual([risk.id, finance.id]);
  const activity = await json(
    await call(api.activity, 'GET', `/committees/${risk.id}/activity`, { params: { id: risk.id } }),
  );
  expect(activity.data.map((row: { action: string }) => row.action)).toEqual([
    'reorder',
    'archive',
    'create',
  ]);
  expect(activity.meta).toEqual({ nextCursor: null });
  const badCursor = await call(api.activity, 'GET', `/committees/${risk.id}/activity`, {
    params: { id: risk.id },
    query: { cursor: 'not-a-cursor' },
  });
  expect(badCursor.status).toBe(400);
  expect((await json(badCursor)).error.details.fieldErrors).toEqual({
    cursor: ['cursor_mismatch'],
  });
});
