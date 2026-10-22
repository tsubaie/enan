import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { insertUser } from '@/core/db/auth-repo';
import { settings, auditLog } from '@/core/db/system-schema';
import { User } from '@/core/http/user-schema';
import { id } from '@/core/db/ids';
import * as api from '../api';
// The two handlers as `/api/v1/admin/settings` exports them, with a real Request against the real
// database. The session is the one seam replaced: the scenarios say who is asking.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
type Meta = { guard: string; status: number; idempotent: boolean };
const meta = (handler: { meta: Meta }) => ({
  guard: handler.meta.guard,
  status: handler.meta.status,
  idempotent: handler.meta.idempotent,
});
type Options = { key?: string; origin?: string; requestedWith?: string | null };
async function call(
  handler: (request: Request) => Promise<Response>,
  method: string,
  body?: object,
  options: Options = {},
) {
  const headers: Record<string, string> = {
    Origin: options.origin ?? env().APP_URL,
    'Content-Type': 'application/json',
    'Idempotency-Key': options.key ?? crypto.randomUUID(),
  };
  if (options.requestedWith !== null)
    headers['X-Requested-With'] = options.requestedWith ?? 'Enan';
  const request = new Request(new URL('/api/v1/admin/settings', env().APP_URL), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request);
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const workspaceRow = async (key: string) =>
  (
    await db()
      .select()
      .from(settings)
      .where(and(eq(settings.key, key), isNull(settings.userId)))
  )[0];
let admin: User;
let member: User;
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  admin = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Admin',
      email: 'admin@example.test',
      passwordHash: 'x',
      role: 'admin',
    }),
  );
  member = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Member',
      email: 'member@example.test',
      passwordHash: 'x',
      role: 'member',
    }),
  );
  session.user = admin;
});
afterAll(() => closeDatabase());

it('ADMIN-B07 both settings endpoints are administrator-only and the write is idempotent', () => {
  expect(meta(api.list)).toEqual({ guard: 'admin', status: 200, idempotent: false });
  expect(meta(api.update)).toEqual({ guard: 'admin', status: 200, idempotent: true });
  expect(api.list.meta.input.safeParse({ key: 'workspace.name' }).success).toBe(false);
});

it('ADMIN-B07 without a session the answer is 401, and a member is refused with the role reason', async () => {
  session.user = null;
  const anonymous = await call(api.list, 'GET');
  expect(anonymous.status).toBe(401);
  expect(anonymous.body).toEqual({
    error: {
      code: 'unauthenticated',
      message: 'unauthenticated',
      details: null,
      requestId: expect.any(String),
    },
  });
  expect((await call(api.update, 'PATCH', { key: 'workspace.name', value: 'Nobody' })).status).toBe(
    401,
  );
  session.user = member;
  const read = await call(api.list, 'GET');
  expect(read.status).toBe(403);
  expect(read.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'role' } });
  const write = await call(api.update, 'PATCH', { key: 'workspace.name', value: 'Member Office' });
  expect(write.status).toBe(403);
  expect(await workspaceRow('workspace.name')).toBeUndefined();
});

it('ADMIN-B07 a write from another origin or without the request marker is refused', async () => {
  const foreign = await call(
    api.update,
    'PATCH',
    { key: 'workspace.name', value: 'X' },
    { origin: 'https://untrusted.example.test' },
  );
  expect(foreign.status).toBe(403);
  expect(foreign.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'origin' } });
  const plain = await call(
    api.update,
    'PATCH',
    { key: 'workspace.name', value: 'X' },
    { requestedWith: null },
  );
  expect(plain.status).toBe(403);
  expect(await workspaceRow('workspace.name')).toBeUndefined();
});

it('ADMIN-B07 the list renders every workspace key from the registry with its value, default and type', async () => {
  const read = await call(api.list, 'GET');
  expect(read.status).toBe(200);
  expect(read.headers.get('Cache-Control')).toBe('no-store');
  expect(Object.keys(read.body)).toEqual(['data']);
  const keys = (read.body.data as { key: string }[]).map((item) => item.key);
  expect(keys).toContain('workspace.name');
  expect(keys).toContain('kpis.status_thresholds');
  expect(keys.some((key) => key.startsWith('user.'))).toBe(false);
  expect(
    read.body.data.find((item: { key: string }) => item.key === 'retention.trash_days'),
  ).toEqual({
    key: 'retention.trash_days',
    value: 30,
    default: 30,
    type: 'number',
  });
  expect(
    read.body.data.find((item: { key: string }) => item.key === 'kpis.status_thresholds'),
  ).toMatchObject({
    type: 'object',
    default: { higher: { on: 0.99, near: 0.85 }, lower: { on: 1.01, near: 1.18 } },
  });
});

it('ADMIN-B07 a valid write is stored once, answered in the envelope, audited, and shown by the next list', async () => {
  const written = await call(api.update, 'PATCH', {
    key: 'workspace.name',
    value: 'Audited Office',
  });
  expect(written.status).toBe(200);
  expect(written.headers.get('X-Request-Id')).toBeTruthy();
  expect(written.body).toEqual({
    data: {
      key: 'workspace.name',
      value: 'Audited Office',
      default: expect.any(String),
      type: 'string',
    },
  });
  expect(await workspaceRow('workspace.name')).toMatchObject({
    value: 'Audited Office',
    scope: 'workspace',
    updatedBy: admin.id,
  });
  const again = await call(api.update, 'PATCH', { key: 'workspace.name', value: 'Renamed Office' });
  expect(again.status).toBe(200);
  const rows = await db().select().from(settings).where(eq(settings.key, 'workspace.name'));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.value).toBe('Renamed Office');
  const audits = await db().select().from(auditLog).where(eq(auditLog.entityType, 'setting'));
  expect(audits).toHaveLength(2);
  expect(audits[0]?.actorId).toBe(admin.id);
  const read = await call(api.list, 'GET');
  expect(read.body.data.find((item: { key: string }) => item.key === 'workspace.name')?.value).toBe(
    'Renamed Office',
  );
});

it('ADMIN-B07 an unknown key is a validation failure and a user-scoped key is forbidden here', async () => {
  const unknown = await call(api.update, 'PATCH', { key: 'workspace.made_up', value: 'x' });
  expect(unknown.status).toBe(400);
  expect(unknown.body.error).toMatchObject({
    code: 'validation_failed',
    message: 'validation_failed',
  });
  const user = await call(api.update, 'PATCH', { key: 'user.locale', value: 'ar' });
  expect(user.status).toBe(403);
  expect(user.body.error.code).toBe('forbidden');
  expect(await db().select().from(settings)).toEqual([]);
  const shape = await call(api.update, 'PATCH', { key: 'workspace.name' });
  expect(shape.status).toBe(400);
  expect(Object.keys(shape.body.error.details.fieldErrors)).toEqual(['value']);
});

it('ADMIN-B07 ADMIN-B09 an invalid value is refused with the field path inside the value, and nothing is stored', async () => {
  const days = await call(api.update, 'PATCH', { key: 'retention.trash_days', value: -1 });
  expect(days.status).toBe(400);
  expect(days.body.error.code).toBe('validation_failed');
  const thresholds = await call(api.update, 'PATCH', {
    key: 'kpis.status_thresholds',
    value: { higher: { on: 'high', near: 0.85 }, lower: { on: 1.01, near: 1.18 } },
  });
  expect(thresholds.status).toBe(400);
  expect(Object.keys(thresholds.body.error.details.fieldErrors)).toEqual(['higher.on']);
  // KPIS-I04: the bands are checked as a pair, so an order violation is reported on the whole value.
  const order = await call(api.update, 'PATCH', {
    key: 'kpis.status_thresholds',
    value: { higher: { on: 0.5, near: 0.85 }, lower: { on: 1.01, near: 1.18 } },
  });
  expect(order.status).toBe(400);
  expect(order.body.error.details.fieldErrors).toEqual({ '': ['thresholds_order'] });
  expect(await db().select().from(settings)).toEqual([]);
  const valid = await call(api.update, 'PATCH', {
    key: 'kpis.status_thresholds',
    value: { higher: { on: 0.9, near: 0.5 }, lower: { on: 1.01, near: 1.18 } },
  });
  expect(valid.status).toBe(200);
  expect(valid.body.data.value).toEqual({
    higher: { on: 0.9, near: 0.5 },
    lower: { on: 1.01, near: 1.18 },
  });
});

it('ADMIN-B07 a retried write replays its answer and a different body under the same key is a 409', async () => {
  const key = crypto.randomUUID();
  const first = await call(
    api.update,
    'PATCH',
    { key: 'retention.backup_count', value: 7 },
    { key },
  );
  expect(first.status).toBe(200);
  const replay = await call(
    api.update,
    'PATCH',
    { key: 'retention.backup_count', value: 7 },
    { key },
  );
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const audits = await db().select().from(auditLog).where(eq(auditLog.entityType, 'setting'));
  expect(audits).toHaveLength(1);
  const reused = await call(
    api.update,
    'PATCH',
    { key: 'retention.backup_count', value: 9 },
    { key },
  );
  expect(reused.status).toBe(409);
  expect(reused.body.error).toMatchObject({ code: 'conflict', details: { reason: 'duplicate' } });
  expect((await workspaceRow('retention.backup_count'))?.value).toBe(7);
  const missing = await call(
    api.update,
    'PATCH',
    { key: 'retention.backup_count', value: 8 },
    { key: 'not-a-uuid' },
  );
  expect(missing.status).toBe(400);
});
