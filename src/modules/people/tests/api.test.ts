import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { closeDatabase } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import type { User } from '@/core/http/user-schema';
import { personDraft } from '../schema/validation';
import * as api from '../api';
import { harness } from './fixtures';
// The route handlers read the session themselves; the scenarios decide who is asking by setting
// this before each call. Everything below the session is real: the database, the services.
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
  method?: string;
  path?: string;
  body?: object;
  key?: string | null;
  origin?: string;
  requestedWith?: string | null;
};
const headersFor = (call: Call) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (call.method && call.method !== 'GET') {
    headers.set('Origin', call.origin ?? env().APP_URL);
    if (call.requestedWith !== null)
      headers.set('X-Requested-With', call.requestedWith ?? 'Enan');
    if (call.key !== null) headers.set('Idempotency-Key', call.key ?? id());
  }
  return headers;
};
async function send(
  handler: (
    request: Request,
    route?: { params: Promise<Record<string, string>> },
  ) => Promise<Response>,
  call: Call = {},
  params: Record<string, string> = {},
) {
  const request = new Request(new URL(`/api/v1/people${call.path ?? ''}`, env().APP_URL), {
    method: call.method ?? 'GET',
    headers: headersFor(call),
    ...(call.body ? { body: JSON.stringify(call.body) } : {}),
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  const body = response.status === 204 ? null : z.json().parse(await response.json());
  return { status: response.status, body, headers: response.headers };
}
type Json = z.infer<ReturnType<typeof z.json>>;
const draft = (fullName: string, fields: object = {}) => ({ ...personDraft(fullName), ...fields });
// The envelopes a scenario reads back, parsed rather than assumed (docs/04 § Envelopes).
const Created = (body: Json) =>
  z
    .object({
      data: z.object({
        id: z.uuid(),
        revision: z.number(),
        deletedAt: z.string().nullable(),
        deletedOpId: z.string().nullable(),
        userId: z.string().nullable(),
      }),
    })
    .parse(body).data;
const Failure = (body: Json) =>
  z.object({ error: z.object({ code: z.string(), details: z.json() }) }).parse(body).error;
const FieldErrors = z.object({ fieldErrors: z.record(z.string(), z.array(z.string())) });
const fieldErrors = (body: Json) => FieldErrors.parse(Failure(body).details).fieldErrors;
const rows = (body: Json) => z.object({ data: z.array(z.json()) }).parse(body).data;
const pageMeta = (body: Json) =>
  z
    .object({ meta: z.object({ nextCursor: z.string().nullable(), total: z.number().optional() }) })
    .parse(body).meta;
it('PEOPLE-B01 PEOPLE-B07 every endpoint needs a session, every create and edit is idempotent, and delete answers 204', () => {
  expect(meta(api.list)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.detail)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.create)).toEqual({ guard: 'session', status: 201, idempotent: true });
  expect(meta(api.patch)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.restore)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.remove)).toEqual({ guard: 'session', status: 204, idempotent: false });
});
it('PEOPLE-B01 PEOPLE-I01 a create answers 201 with the envelope, reports a homonym, and proceeds once confirmed', async () => {
  const first = await send(api.create, { method: 'POST', body: draft('Leila Haddad') });
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    data: { fullName: 'Leila Haddad', kind: 'external', isAssignable: false, revision: 1 },
    meta: { possibleDuplicates: [] },
  });
  expect(first.headers.get('X-Request-Id')).toBeTruthy();
  const homonym = await send(api.create, {
    method: 'POST',
    body: draft('leila haddad', { confirmDuplicate: false }),
  });
  expect(homonym.status).toBe(201);
  expect(homonym.body).toMatchObject({
    data: null,
    meta: { possibleDuplicates: [{ id: Created(first.body).id }] },
  });
  const confirmed = await send(api.create, {
    method: 'POST',
    body: draft('leila haddad', { confirmDuplicate: true }),
  });
  expect(confirmed.status).toBe(201);
  expect(Created(confirmed.body).id).not.toBe(Created(first.body).id);
  const listed = await send(api.list, { path: '?view=all' });
  expect(rows(listed.body)).toHaveLength(2);
});
it('PEOPLE-B01 a validation failure names each field with its dotted path', async () => {
  const response = await send(api.create, {
    method: 'POST',
    body: draft('  ', { tags: ['Board', ''], email: 'not-an-email', kind: 'robot' }),
  });
  expect(response.status).toBe(400);
  const failure = Failure(response.body);
  expect(failure.code).toBe('validation_failed');
  expect(Object.keys(fieldErrors(response.body)).sort()).toEqual([
    'email',
    'fullName',
    'kind',
    'tags.1',
  ]);
  // An unknown parameter on the list is refused the same way.
  const list = await send(api.list, { path: '?view=made_up' });
  expect(list.status).toBe(400);
  expect(fieldErrors(list.body)).toHaveProperty('view');
});
it('PEOPLE-B01 no session is 401 and a write from elsewhere is 403', async () => {
  session.user = null;
  expect((await send(api.list)).status).toBe(401);
  const anonymous = await send(api.create, { method: 'POST', body: draft('Nobody') });
  expect(anonymous.status).toBe(401);
  expect(Failure(anonymous.body).code).toBe('unauthenticated');
  session.user = harness.user;
  const crossOrigin = await send(api.create, {
    method: 'POST',
    body: draft('Elsewhere'),
    origin: 'https://untrusted.example.test',
  });
  expect(crossOrigin.status).toBe(403);
  expect(Failure(crossOrigin.body)).toMatchObject({
    code: 'forbidden',
    details: { reason: 'origin' },
  });
  const plainForm = await send(api.create, {
    method: 'POST',
    body: draft('Elsewhere'),
    requestedWith: null,
  });
  expect(plainForm.status).toBe(403);
  expect((await send(api.list, { path: '?view=all' })).status).toBe(200);
  const listed = await send(api.list, { path: '?view=all' });
  expect(rows(listed.body)).toEqual([]);
});
it('PEOPLE-I02 linking a member is for administrators, and a member links to one person only', async () => {
  const admin = harness.user;
  if (!admin) throw new Error('harness not reset');
  const member = await harness.account('member');
  session.user = member;
  const refused = await send(api.create, {
    method: 'POST',
    body: draft('Self link', { userId: member.id }),
  });
  expect(refused.status).toBe(403);
  expect(Failure(refused.body)).toMatchObject({ code: 'forbidden', details: { reason: 'role' } });
  // The same member may still create and edit people, as long as no link is in the body.
  const plain = await send(api.create, { method: 'POST', body: draft('Plain member create') });
  expect(plain.status).toBe(201);
  const memberPatch = await send(
    api.patch,
    {
      method: 'PATCH',
      path: `/${Created(plain.body).id}`,
      body: { revision: 1, organization: 'Cedar' },
    },
    { id: Created(plain.body).id },
  );
  expect(memberPatch.status).toBe(200);
  const memberLink = await send(
    api.patch,
    {
      method: 'PATCH',
      path: `/${Created(plain.body).id}`,
      body: { revision: 2, userId: member.id },
    },
    { id: Created(plain.body).id },
  );
  expect(memberLink.status).toBe(403);
  session.user = admin;
  const linked = await send(api.create, {
    method: 'POST',
    body: draft('Linked', { userId: member.id }),
  });
  expect(linked.status).toBe(201);
  expect(Created(linked.body)).toMatchObject({ userId: member.id });
  const again = await send(api.create, {
    method: 'POST',
    body: draft('Linked twice', { userId: member.id }),
  });
  expect(again.status).toBe(409);
  expect(Failure(again.body)).toMatchObject({ code: 'conflict', details: { reason: 'state' } });
  const other = Created(plain.body);
  const relink = await send(
    api.patch,
    { method: 'PATCH', path: `/${other.id}`, body: { revision: 2, userId: member.id } },
    { id: other.id },
  );
  expect(relink.status).toBe(409);
  expect(Failure(relink.body)).toMatchObject({ code: 'conflict', details: { reason: 'state' } });
});
it('PEOPLE-B02 PEOPLE-B08 the list answers data, counts and a cursor, and a total only when asked', async () => {
  for (const name of ['Alpha', 'Bravo', 'Charlie'])
    await send(api.create, {
      method: 'POST',
      body: draft(name, { isAssignable: name === 'Alpha' }),
    });
  const page = await send(api.list, { path: '?view=all&limit=2' });
  expect(page.status).toBe(200);
  expect(page.body).toMatchObject({
    data: [{ fullName: 'Alpha' }, { fullName: 'Bravo' }],
    meta: { counts: { all: 3, assignable: 1, internal: 0, external: 3, trash: 0 } },
  });
  const first = pageMeta(page.body);
  expect(first.nextCursor).toEqual(expect.any(String));
  expect(first).not.toHaveProperty('total');
  const rest = await send(api.list, { path: `?view=all&limit=2&cursor=${first.nextCursor}` });
  expect(rest.body).toMatchObject({ data: [{ fullName: 'Charlie' }], meta: { nextCursor: null } });
  const counted = await send(api.list, { path: '?view=assignable&withTotal=true' });
  expect(counted.body).toMatchObject({ data: [{ fullName: 'Alpha' }], meta: { total: 1 } });
});
it('PEOPLE-B03 PEOPLE-B07 a stale revision is 409, a deleted person is 404 until asked for, and the op id restores them', async () => {
  const created = Created(
    (await send(api.create, { method: 'POST', body: draft('Transient') })).body,
  );
  const params = { id: created.id };
  const stale = await send(
    api.remove,
    { method: 'DELETE', path: `/${created.id}`, body: { revision: 9 } },
    params,
  );
  expect(stale.status).toBe(409);
  expect(Failure(stale.body)).toMatchObject({
    code: 'conflict',
    details: { reason: 'revision', current: { id: created.id, revision: 1 } },
  });
  const removed = await send(
    api.remove,
    { method: 'DELETE', path: `/${created.id}`, body: { revision: 1 } },
    params,
  );
  expect(removed.status).toBe(204);
  expect(removed.body).toBeNull();
  const opId = removed.headers.get('X-Op-Id') ?? '';
  expect(opId).toMatch(/^[0-9a-f-]{36}$/u);
  const gone = await send(api.detail, { path: `/${created.id}` }, params);
  expect(gone.status).toBe(404);
  expect(Failure(gone.body)).toMatchObject({
    code: 'not_found',
    details: { entityType: 'person' },
  });
  const trashed = await send(api.detail, { path: `/${created.id}?includeDeleted=true` }, params);
  expect(trashed.status).toBe(200);
  expect(Created(trashed.body).deletedAt).toEqual(expect.any(String));
  const edit = await send(
    api.patch,
    { method: 'PATCH', path: `/${created.id}`, body: { revision: 2, organization: 'Cedar' } },
    params,
  );
  expect(edit.status).toBe(404);
  const wrongOp = await send(
    api.restore,
    { method: 'POST', path: `/${created.id}/restore`, body: { opId: id() } },
    params,
  );
  expect(wrongOp.status).toBe(409);
  const restored = await send(
    api.restore,
    { method: 'POST', path: `/${created.id}/restore`, body: { opId } },
    params,
  );
  expect(restored.status).toBe(200);
  expect(Created(restored.body)).toMatchObject({
    id: created.id,
    deletedAt: null,
    deletedOpId: null,
  });
  expect((await send(api.detail, { path: `/${created.id}` }, params)).status).toBe(200);
  expect((await send(api.detail, { path: `/${id()}` }, { id: id() })).status).toBe(404);
});
it('PEOPLE-B01 a replayed Idempotency-Key returns the stored response and a changed payload under it is 409', async () => {
  const key = id();
  const first = await send(api.create, { method: 'POST', body: draft('Once'), key });
  const replay = await send(api.create, { method: 'POST', body: draft('Once'), key });
  expect(first.status).toBe(201);
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  const changed = await send(api.create, { method: 'POST', body: draft('Once more'), key });
  expect(changed.status).toBe(409);
  expect(Failure(changed.body)).toMatchObject({
    code: 'conflict',
    details: { reason: 'duplicate' },
  });
  // One person exists: the replay created nothing, and the conflict created nothing.
  const listed = await send(api.list, { path: '?view=all' });
  expect(rows(listed.body)).toHaveLength(1);
  // An idempotent write without a key is a validation failure, not a silent one-off.
  const keyless = await send(api.create, { method: 'POST', body: draft('Keyless'), key: null });
  expect(keyless.status).toBe(400);
});
