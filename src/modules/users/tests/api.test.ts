import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { enqueue } from '@/core/db/jobs-repo';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import { auditLog, jobs, users } from '@/core/db/system-schema';
import { authAccounts, authSessions } from '@/core/db/auth-schema';
import { getSetting } from '@/core/db/settings-repo';
import { verifyPassword } from '@/core/auth/password';
import { User } from '@/core/http/user-schema';
import { createBackup, listBackups } from '@/core/backup/dump';
import * as api from '../api';
import * as admin from '@/core/http/admin-api';
import * as controls from '@/core/http/ai-controls-api';
import { recoveryApi } from '@/core/auth/api';
import { update as updateSetting } from '@/modules/settings/api';
import { addSession, addUser, harness } from './fixtures';
// The session is the only thing the handlers read from the request environment; the rest of the
// auth module stays real so setup can still mint a session row and the login route still verifies.
const session = vi.hoisted(() => ({
  user: null as User | null,
  localeCookie: null as string | null,
}));
vi.mock('@/core/auth/session', async (original) => ({
  ...(await original<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
  setSessionCookie: async () => {},
  setLocaleCookie: async (locale: string) => {
    session.localeCookie = locale;
  },
}));
// Recovery is throttled per client address only (ADMIN-B22); a test that needs a bucket sets one.
const address = vi.hoisted(() => ({ ip: null as string | null }));
vi.mock('@/core/http/client-ip', () => ({ clientIp: () => address.ip }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await harness.reset();
  session.user = harness.user;
  address.ip = null;
});
afterAll(() => closeDatabase());
type Meta = { guard: string; status: number; idempotent: boolean; enqueues: boolean };
const meta = (handler: { meta: Meta }) => ({
  guard: handler.meta.guard,
  status: handler.meta.status,
  idempotent: handler.meta.idempotent,
  enqueues: handler.meta.enqueues,
});
const writeHeaders = (origin = env().APP_URL) => ({
  Origin: origin,
  'X-Requested-With': 'Enan',
  'Content-Type': 'application/json',
});
function request(
  method: string,
  path: string,
  body?: object,
  options: { key?: string | null | undefined; origin?: string; requestedWith?: boolean } = {},
) {
  const headers: Record<string, string> = method === 'GET' ? {} : writeHeaders(options.origin);
  if (options.requestedWith === false) delete headers['X-Requested-With'];
  if (options.key !== null) headers['Idempotency-Key'] = options.key ?? crypto.randomUUID();
  return new Request(new URL(`/api/v1${path}`, env().APP_URL), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = (value: string) => ({ params: Promise.resolve({ id: value }) });
const invite = (email: string, role: 'admin' | 'member' = 'member', key?: string) =>
  api.create(request('POST', '/admin/users', { name: 'Invited', email, role }, { key }));
const patch = (userId: string, body: object, options: Parameters<typeof request>[3] = {}) =>
  api.patch(request('PATCH', `/admin/users/${userId}`, body, options), params(userId));
const patchOf = (user: User) => ({
  name: user.name,
  role: user.role,
  isActive: user.isActive,
  revision: user.revision,
});
const liveSessions = (userId: string) =>
  db().select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.userId, userId));
it('ADMIN-B03 ADMIN-B01 ADMIN-B02 member administration is admin-guarded and its writes are idempotent; setup and recovery are public', () => {
  expect(meta(api.list)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
  expect(meta(api.create)).toEqual({
    guard: 'admin',
    status: 201,
    idempotent: true,
    enqueues: false,
  });
  expect(meta(api.patch)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: true,
    enqueues: false,
  });
  expect(meta(api.setupApi)).toEqual({
    guard: 'public',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
  expect(meta(recoveryApi)).toEqual({
    guard: 'public',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
});
it('ADMIN-B12 ADMIN-B15 ADMIN-B16 ADMIN-B10 backups, jobs, audit and the AI connection are admin-only; what enqueues says so', () => {
  expect(meta(admin.backups)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
  expect(meta(admin.backupCreate)).toEqual({
    guard: 'admin',
    status: 202,
    idempotent: true,
    enqueues: true,
  });
  expect(meta(admin.jobList)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
  expect(meta(admin.jobAction)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: true,
    enqueues: true,
  });
  expect(meta(admin.auditList)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
  expect(meta(admin.aiStatus)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
  expect(meta(admin.aiTest)).toEqual({
    guard: 'admin',
    status: 200,
    idempotent: false,
    enqueues: false,
  });
  expect(meta(controls.read).guard).toBe('admin');
  expect(meta(controls.save).guard).toBe('admin');
});
it('ADMIN-B03 inviting a member answers 201 with the account and a one-time password in the envelope', async () => {
  const response = await invite('New.Member@Example.test');
  expect(response.status).toBe(201);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Request-Id')).toBeTruthy();
  const body = await response.json();
  expect(body).toEqual({
    data: {
      id: expect.any(String),
      email: 'new.member@example.test',
      name: 'Invited',
      role: 'member',
      isActive: true,
      revision: 1,
    },
    meta: { temporaryPassword: expect.any(String) },
  });
  expect(JSON.stringify(body.data)).not.toContain('passwordHash');
  const listed = await api.list(request('GET', '/admin/users'));
  expect(listed.status).toBe(200);
  const { data } = await listed.json();
  expect(data.map((user: User) => user.email).sort()).toEqual([
    'admin@example.test',
    'new.member@example.test',
  ]);
  expect(data.every((user: User) => !('passwordHash' in user))).toBe(true);
});
it('ADMIN-B03 inviting an address an account already holds is a field error, not a crash', async () => {
  expect((await invite('taken@example.test')).status).toBe(201);
  const again = await invite('Taken@Example.test');
  expect(again.status).toBe(400);
  expect(await again.json()).toMatchObject({
    error: { code: 'validation_failed', details: { fieldErrors: { email: ['email_taken'] } } },
  });
});
it('ADMIN-B03 a bad invitation names each field by its path and writes nothing', async () => {
  const response = await api.create(
    request('POST', '/admin/users', { name: ' ', email: 'nope', role: 'owner', extra: 1 }),
  );
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.error.code).toBe('validation_failed');
  expect(Object.keys(body.error.details.fieldErrors).sort()).toEqual(['', 'email', 'name', 'role']);
  const malformed = await api.create(
    new Request(new URL('/api/v1/admin/users', env().APP_URL), {
      method: 'POST',
      headers: { ...writeHeaders(), 'Idempotency-Key': crypto.randomUUID() },
      body: '{not json',
    }),
  );
  expect(malformed.status).toBe(400);
  expect(await db().select().from(users)).toHaveLength(1);
});
it('ADMIN-B03 a signed-out caller gets 401 and a member gets 403 on every member route', async () => {
  session.user = null;
  expect((await api.list(request('GET', '/admin/users'))).status).toBe(401);
  expect((await invite('x@example.test')).status).toBe(401);
  expect((await patch(id(), {})).status).toBe(401);
  const member = await addUser('member', 'member@example.test');
  session.user = member;
  for (const response of [
    await api.list(request('GET', '/admin/users')),
    await invite('x@example.test'),
    await patch(member.id, patchOf(member)),
    await admin.backups(request('GET', '/admin/backups')),
    await admin.jobList(request('GET', '/admin/jobs')),
    await admin.auditList(request('GET', '/admin/audit')),
    await admin.aiStatus(request('GET', '/admin/ai')),
    await controls.read(request('GET', '/admin/ai/controls')),
  ]) {
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'forbidden', details: { reason: 'role' } },
    });
  }
  expect(await db().select().from(users)).toHaveLength(2);
});
it('ADMIN-B03 a write from another origin or without the app header is refused before it is read', async () => {
  const foreign = await invite('x@example.test', 'member', undefined);
  expect(foreign.status).toBe(201);
  const crossOrigin = await api.create(
    request(
      'POST',
      '/admin/users',
      { name: 'X', email: 'y@example.test', role: 'member' },
      { origin: 'https://evil.example.test' },
    ),
  );
  expect(crossOrigin.status).toBe(403);
  expect(await crossOrigin.json()).toMatchObject({ error: { details: { reason: 'origin' } } });
  const noHeader = await api.create(
    request(
      'POST',
      '/admin/users',
      { name: 'X', email: 'z@example.test', role: 'member' },
      { requestedWith: false },
    ),
  );
  expect(noHeader.status).toBe(403);
  expect(await db().select().from(users)).toHaveLength(2);
});
it('ADMIN-B03 an edit of an unknown account is 404 and a stale one is 409 carrying the current record', async () => {
  const member = await addUser('member', 'member@example.test');
  const missing = await patch(id(), patchOf(member));
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });
  const stale = await patch(member.id, { ...patchOf(member), name: 'Lost', revision: 7 });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    error: {
      code: 'conflict',
      details: { reason: 'revision', current: { id: member.id, revision: 1 } },
    },
  });
  const fresh = await patch(member.id, { ...patchOf(member), name: 'Kept' });
  expect(fresh.status).toBe(200);
  expect(await fresh.json()).toEqual({ data: { ...member, name: 'Kept', revision: 2 } });
  const [entry] = await db().select().from(auditLog).where(eq(auditLog.entityId, member.id));
  expect(entry).toMatchObject({ action: 'update', entityType: 'user', actorId: harness.user?.id });
});
it('ADMIN-B03 the same Idempotency-Key replays the invitation and a different payload under it is a duplicate', async () => {
  const key = crypto.randomUUID();
  const first = await invite('once@example.test', 'member', key);
  const replay = await invite('once@example.test', 'member', key);
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(await first.clone().json());
  const changed = await invite('twice@example.test', 'member', key);
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({
    error: { code: 'conflict', details: { reason: 'duplicate' } },
  });
  expect(await db().select().from(users)).toHaveLength(2);
  // A write on an idempotent route must carry a key at all.
  const keyless = await api.create(
    request(
      'POST',
      '/admin/users',
      { name: 'K', email: 'four@example.test', role: 'member' },
      { key: null },
    ),
  );
  expect(keyless.status).toBe(400);
  expect(await db().select().from(users)).toHaveLength(2);
});
it('ADMIN-A02 ADMIN-B04 the API refuses to deactivate or demote the only administrator until a second one exists', async () => {
  const only = harness.user;
  if (!only) throw new Error('harness not reset');
  const deactivate = await patch(only.id, { ...patchOf(only), isActive: false });
  expect(deactivate.status).toBe(422);
  expect(await deactivate.json()).toMatchObject({
    error: { code: 'rule_violation', details: { rule: 'ADMIN-B04' } },
  });
  const demote = await patch(only.id, { ...patchOf(only), role: 'member' });
  expect(demote.status).toBe(422);
  const second = await invite('second@example.test', 'admin');
  expect(second.status).toBe(201);
  await addSession(only.id);
  const allowed = await patch(only.id, { ...patchOf(only), isActive: false });
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toMatchObject({
    data: { id: only.id, isActive: false, revision: 2 },
  });
  expect(await liveSessions(only.id)).toHaveLength(0);
});
it('ADMIN-B02 ADMIN-A06 recovery resets a chosen administrator once; the second use and a member are refused', async () => {
  const token = env().RECOVERY_TOKEN ?? '';
  session.user = null;
  const target = await addUser('admin', 'locked-out@example.test');
  await addSession(target.id);
  const member = await addUser('member', 'member@example.test');
  const recover = (email: string, value: string, password = 'a-brand-new-password-1') =>
    recoveryApi(request('POST', '/recovery', { email, password, token: value }, { key: null }));
  const wrong = await recover(target.email, 'not-the-token');
  expect(wrong.status).toBe(403);
  const weak = await recover(target.email, token, 'short');
  expect(weak.status).toBe(400);
  expect(await weak.json()).toMatchObject({
    error: { details: { fieldErrors: { password: expect.any(Array) } } },
  });
  const notAdmin = await recover(member.email, token);
  expect(notAdmin.status).toBe(404);
  const done = await recover(target.email, token);
  expect(done.status).toBe(200);
  expect(await done.json()).toEqual({ data: null });
  expect(await liveSessions(target.id)).toHaveLength(0);
  // The new password is where Better Auth reads it (ADR 0055) and on the row, which moved on.
  const [credential] = await db()
    .select({ password: authAccounts.password })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, target.id), eq(authAccounts.providerId, 'credential')));
  expect(await verifyPassword(credential?.password ?? '', 'a-brand-new-password-1')).toBe(true);
  expect((await db().select().from(users).where(eq(users.id, target.id)))[0]).toMatchObject({
    revision: 2,
    passwordHash: credential?.password,
  });
  const again = await recover(target.email, token, 'yet-another-password-2');
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({
    error: { code: 'conflict', details: { reason: 'state' } },
  });
  const used = await db().get<{ count: number }>(
    sql`select count(*) as count from recovery_token_uses`,
  );
  expect(used?.count).toBe(1);
});
it('ADMIN-B22 wrong recovery tokens over HTTP are recorded, so the sixth attempt is throttled', async () => {
  session.user = null;
  address.ip = '203.0.113.7';
  const target = await addUser('admin', 'locked-out@example.test');
  const attempt = () =>
    recoveryApi(
      request(
        'POST',
        '/recovery',
        { email: target.email, password: 'a-brand-new-password-1', token: 'not-the-token' },
        { key: null },
      ),
    );
  for (let failure = 0; failure < 5; failure++) expect((await attempt()).status).toBe(403);
  const throttled = await attempt();
  expect(throttled.status).toBe(429);
  expect(await throttled.json()).toMatchObject({ error: { code: 'rate_limited' } });
});
it('ADMIN-B12 an administrator deletes a backup for good, the deletion is audited, and a member is refused', async () => {
  const backupId = crypto.randomUUID();
  await createBackup(backupId);
  const remove = (value: string) =>
    admin.backupDelete(request('DELETE', `/admin/backups/${value}`, {}), params(value));
  session.user = User.parse({ ...harness.user, role: 'member' });
  expect((await remove(backupId)).status).toBe(403);
  session.user = harness.user;
  const removed = await remove(backupId);
  expect(removed.status).toBe(200);
  expect((await listBackups()).map((backup) => backup.id)).not.toContain(backupId);
  const [entry] = await db().select().from(auditLog).where(eq(auditLog.entityId, backupId));
  expect(entry).toMatchObject({ action: 'delete', entityType: 'backup' });
  expect((await remove(backupId)).status).toBe(404);
  expect((await remove('..')).status).toBe(404);
  expect(await db().select().from(auditLog).where(eq(auditLog.entityId, backupId))).toHaveLength(1);
});
it('ADMIN-B15 a failed system job can be retried; a failed AI job cannot, so the budget is never skipped', async () => {
  const failed = async (kind: string) => {
    const job = await withTransaction(db(), (database) => enqueue(database, kind, {}, null));
    await db().update(jobs).set({ status: 'failed' }).where(eq(jobs.id, job.id));
    return job.id;
  };
  const retry = (jobId: string) =>
    admin.jobAction(request('POST', `/admin/jobs/${jobId}`, { action: 'retry' }), params(jobId));
  expect((await retry(await failed('system.prune'))).status).toBe(200);
  const refused = await retry(await failed('ai.tasks.breakdown'));
  expect(refused.status).toBe(422);
  expect(await refused.json()).toMatchObject({
    error: { code: 'rule_violation', details: { rule: 'ADMIN-B15' } },
  });
  expect(await db().select().from(jobs).where(eq(jobs.kind, 'ai.tasks.breakdown'))).toHaveLength(1);
});
it('ADMIN-B12 ADMIN-B15 ADMIN-B16 Create now enqueues one backup, the jobs page lists it, and the audit page shows the change without secrets', async () => {
  const created = await admin.backupCreate(request('POST', '/admin/backups', {}));
  expect(created.status).toBe(202);
  const { data } = await created.json();
  const repeat = await admin.backupCreate(request('POST', '/admin/backups', {}));
  expect((await repeat.json()).data.id).toBe(data.id);
  const [job] = await db().select().from(jobs);
  expect(job).toMatchObject({
    id: data.id,
    kind: 'system.backup',
    status: 'queued',
    createdBy: harness.user?.id,
  });
  const listed = await admin.jobList(request('GET', '/admin/jobs'));
  expect(await listed.json()).toMatchObject({
    data: [{ id: data.id, kind: 'system.backup', status: 'queued', attempt: 0 }],
  });
  // A queued job cannot be retried, only cancelled; an unknown one is 404.
  const retry = await admin.jobAction(
    request('POST', `/admin/jobs/${data.id}`, { action: 'retry' }),
    params(data.id),
  );
  expect(retry.status).toBe(409);
  const unknown = await admin.jobAction(
    request('POST', `/admin/jobs/${id()}`, { action: 'cancel' }),
    params(id()),
  );
  expect(unknown.status).toBe(404);
  const cancel = await admin.jobAction(
    request('POST', `/admin/jobs/${data.id}`, { action: 'cancel' }),
    params(data.id),
  );
  expect(cancel.status).toBe(200);
  expect((await db().select().from(jobs))[0]?.cancelRequested).toBe(true);
  const invited = await (await invite('audited@example.test')).json();
  const audit = await admin.auditList(request('GET', '/admin/audit'));
  const entries = (await audit.json()).data;
  expect(entries).toContainEqual(
    expect.objectContaining({
      action: 'create',
      entityType: 'user',
      diff: { name: 'Invited', email: 'audited@example.test', role: 'member' },
    }),
  );
  expect(JSON.stringify(entries)).not.toContain(invited.meta.temporaryPassword);
});
it('ADMIN-B10 the AI page reads the connection status, tests it without credentials as disabled, and saves capability toggles and the budget', async () => {
  const status = await admin.aiStatus(request('GET', '/admin/ai'));
  expect(await status.json()).toEqual({
    data: { state: expect.any(String), checkedAt: null, error: null },
  });
  const tested = await admin.aiTest(request('POST', '/admin/ai', {}));
  expect(tested.status).toBe(200);
  expect(await tested.json()).toEqual({
    data: { state: 'disabled', checkedAt: expect.any(String), error: null },
  });
  const before = await controls.read(request('GET', '/admin/ai/controls'));
  expect(await before.json()).toMatchObject({
    data: {
      enabledCapabilities: [
        'tasks.breakdown',
        'notes.refine',
        'notes.suggest_tags',
        'kpis.narrative',
      ],
      monthlyBudgetMicros: null,
      usedTokens: 0,
      reservedTokens: 0,
      usedCostMicros: 0,
      reservedCostMicros: 0,
      usage: [],
    },
  });
  const saved = await controls.save(
    request('PUT', '/admin/ai/controls', {
      enabledCapabilities: ['notes.refine'],
      monthlyBudgetMicros: 25000000,
    }),
  );
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    data: { enabledCapabilities: ['notes.refine'], monthlyBudgetMicros: 25000000 },
  });
  expect(await getSetting(db(), 'ai.enabled_capabilities')).toEqual(['notes.refine']);
  expect(await getSetting(db(), 'ai.monthly_budget_micros')).toBe(25000000);
  const invalid = await controls.save(
    request('PUT', '/admin/ai/controls', {
      enabledCapabilities: ['tasks.everything'],
      monthlyBudgetMicros: 0,
    }),
  );
  expect(invalid.status).toBe(400);
  expect(Object.keys((await invalid.json()).error.details.fieldErrors).sort()).toEqual([
    'enabledCapabilities.0',
    'monthlyBudgetMicros',
  ]);
});
it('ADMIN-B09 KPI thresholds are validated as a workspace setting: bands out of order are a field error, ordered ones are saved', async () => {
  const send = (value: object) =>
    updateSetting(request('PUT', '/admin/settings', { key: 'kpis.status_thresholds', value }));
  const disordered = await send({
    higher: { on: 0.5, near: 0.9 },
    lower: { on: 1.01, near: 1.18 },
  });
  expect(disordered.status).toBe(400);
  expect(await disordered.json()).toMatchObject({
    error: { code: 'validation_failed', details: { fieldErrors: { '': ['thresholds_order'] } } },
  });
  const outOfRange = await send({
    higher: { on: 101, near: 0.9 },
    lower: { on: 1.01, near: 1.18 },
  });
  expect(Object.keys((await outOfRange.json()).error.details.fieldErrors)).toEqual(['higher.on']);
  const ordered = { higher: { on: 0.9, near: 0.5 }, lower: { on: 1.01, near: 1.18 } };
  const saved = await send(ordered);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    data: { key: 'kpis.status_thresholds', value: ordered },
  });
  expect(await getSetting(db(), 'kpis.status_thresholds')).toEqual(ordered);
  session.user = await addUser('member', 'member@example.test');
  expect((await send(ordered)).status).toBe(403);
});
it('ADMIN-B13 maintenance mode answers 503 on every route, public ones included, until it is cleared', async () => {
  // The handler caches the flag for two seconds; the clock is moved past that window on both sides
  // so the scenario observes the flag and not the cache.
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 5000);
    await db().run(
      sql`insert into workspace (id, maintenance_mode) values (1, 1) on conflict (id) do update set maintenance_mode = 1`,
    );
    const listed = await api.list(request('GET', '/admin/users'));
    expect(listed.status).toBe(503);
    expect(await listed.json()).toEqual({
      error: { code: 'maintenance', requestId: expect.any(String) },
    });
    session.user = null;
    const recovery = recoveryApi(
      request(
        'POST',
        '/recovery',
        { email: 'a@example.test', password: 'a-brand-new-password-1', token: 'x' },
        { key: null },
      ),
    );
    expect((await recovery).status).toBe(503);
    expect((await admin.backups(request('GET', '/admin/backups'))).status).toBe(503);
    await db().run(sql`update workspace set maintenance_mode = 0 where id = 1`);
    vi.setSystemTime(Date.now() + 5000);
    session.user = harness.user;
    expect((await api.list(request('GET', '/admin/users'))).status).toBe(200);
  } finally {
    vi.useRealTimers();
  }
});
