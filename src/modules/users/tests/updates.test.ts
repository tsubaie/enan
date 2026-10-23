import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import { auditLog, jobs, notifications } from '@/core/db/system-schema';
import { User } from '@/core/http/user-schema';
import * as admin from '@/core/http/admin-api';
import { addUser, harness } from './fixtures';
import {
  commandsLeft,
  folders,
  removeAll,
  replaceStatus,
  reset,
  type Folders,
} from '@/core/updates/tests/fixtures';
import { notifyUpdates, resolve, subjectId, updatesJob } from '../notifications';
import { watchUpdates } from '../jobs';

// The updater's two volumes, as folders this file creates; the rest of the configuration is real.
const dirs = vi.hoisted(() => ({ current: null as Folders | null }));
vi.mock('@/core/config/env', async (original) => {
  const actual = await original<typeof import('@/core/config/env')>();
  return {
    ...actual,
    env: () => ({
      ...actual.env(),
      UPDATER_STATUS_DIR: dirs.current?.status ?? '',
      UPDATER_COMMANDS_DIR: dirs.current?.commands ?? '',
    }),
  };
});
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (original) => ({
  ...(await original<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

const current = () => {
  if (!dirs.current) throw new Error('folders are made in beforeAll');
  return dirs.current;
};
const now = new Date('2026-10-22T12:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000).toISOString();
const entry = (fields: object) => ({
  channel: 'latest',
  state: 'checked',
  intervalSeconds: 900,
  lastCheckAt: minutes(-1),
  paused: false,
  ...fields,
});
async function updater(status: object | null, history: object[] = []) {
  if (!dirs.current) throw new Error('folders are made in beforeAll');
  await reset(
    dirs.current,
    status ? JSON.stringify(entry(status)) : null,
    history.map((line) => JSON.stringify(line)).join('\n'),
  );
}
const request = (method: string, body?: object) =>
  new Request(new URL('/api/v1/admin/updates', env().APP_URL), {
    method,
    headers:
      method === 'GET'
        ? {}
        : { Origin: env().APP_URL, 'X-Requested-With': 'Enan', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const lastRun = (finishedAt: Date) =>
  db()
    .insert(jobs)
    .values({ id: id(), kind: updatesJob, payload: {}, status: 'succeeded', finishedAt });
// As the runner calls it: the run is already marked succeeded when its publish effect runs.
async function run(at: Date) {
  const job = id();
  await db()
    .insert(jobs)
    .values({ id: job, kind: updatesJob, payload: {}, status: 'succeeded', finishedAt: at });
  await notifyUpdates(db(), job, at);
}
const rows = () =>
  db()
    .select({
      userId: notifications.userId,
      kind: notifications.kind,
      subjectId: notifications.subjectId,
    })
    .from(notifications);

beforeAll(async () => {
  dirs.current = await folders();
  await migrateDatabase();
});
beforeEach(async () => {
  await harness.reset();
  session.user = harness.user;
  await updater(null);
});
afterAll(async () => {
  closeDatabase();
  if (dirs.current) await removeAll(dirs.current);
});

it('ADMIN-B57 only an administrator reads the updater or sends it a command', async () => {
  session.user = await addUser('member', 'member@example.test');
  for (const response of [
    await admin.updates(request('GET')),
    await admin.updateCommand(request('POST', { command: 'check' })),
  ])
    expect(response.status).toBe(403);
  expect((await commandsLeft(current())).files).toEqual([]);
});

it('ADMIN-B57 without the updater the page is told it is not running, and commands are refused', async () => {
  const listed = await admin.updates(request('GET'));
  expect(await listed.json()).toMatchObject({
    data: { health: 'not_running', status: null, history: [] },
  });
  const refused = await admin.updateCommand(request('POST', { command: 'check' }));
  expect(refused.status).toBe(409);
  expect((await commandsLeft(current())).files).toEqual([]);
  expect(await db().select().from(auditLog).where(eq(auditLog.entityType, 'updater'))).toEqual([]);
});

it('ADMIN-B58 a command is left for the updater and written to the audit log', async () => {
  await updater({ state: 'checked', running: { version: '1.0.0' } });
  const sent = await admin.updateCommand(request('POST', { command: 'pause' }));
  expect(sent.status).toBe(202);
  expect(await sent.json()).toEqual({ data: { command: 'pause' } });
  expect((await commandsLeft(current())).commands).toEqual(['pause']);
  const audit = await db()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'updater'), eq(auditLog.action, 'update_pause')));
  expect(audit).toHaveLength(1);
  expect((await admin.updateCommand(request('POST', { command: 'rollback' }))).status).toBe(400);
  expect((await admin.updateCommand(request('POST', { command: 'check', x: 1 }))).status).toBe(400);
});

it('ADMIN-B59 every active administrator hears of each new outcome once, members never', async () => {
  const second = await addUser('admin', 'second@example.test');
  await addUser('admin', 'gone@example.test', { isActive: false });
  await addUser('member', 'member@example.test');
  const installed = entry({
    state: 'updated',
    running: { version: '1.1.0', digest: 'sha256:two' },
    finishedAt: minutes(-3),
  });
  const rolledBack = entry({
    state: 'rolled_back',
    step: 'verify',
    candidate: { version: '1.2.0', digest: 'sha256:three' },
    finishedAt: minutes(-2),
  });
  const quiet = entry({ state: 'checked', finishedAt: minutes(-1) });
  // Held back because it failed before: already reported as failed, so nothing new.
  const heldAgain = entry({
    state: 'blocked',
    step: 'check',
    candidate: { version: '1.2.0', digest: 'sha256:three' },
    finishedAt: minutes(-1),
  });
  const unreachable = entry({ state: 'failed', step: 'check', finishedAt: minutes(-1) });
  await updater({ state: 'checked' }, [installed, rolledBack, quiet, unreachable, heldAgain]);
  await lastRun(new Date(minutes(-5)));
  await run(now);
  const written = await rows();
  expect(written.map((row) => row.kind).sort()).toEqual([
    'update.failed',
    'update.failed',
    'update.installed',
    'update.installed',
  ]);
  expect(new Set(written.map((row) => row.userId))).toEqual(new Set([harness.user?.id, second.id]));
  // The next run covers only what came after it: nothing new, nothing written twice.
  await run(new Date(minutes(5)));
  expect(await rows()).toHaveLength(4);
});

it('ADMIN-B59 an updater that goes quiet is reported once, on the run that notices', async () => {
  // Interval 15 min: stalled after 50 min without a check.
  await updater({ state: 'checked', lastCheckAt: minutes(-52), running: { version: '1.1.0' } });
  await lastRun(new Date(minutes(-5)));
  await run(now);
  expect((await rows()).map((row) => row.kind)).toEqual(['update.stalled']);
  // The line still names the version once the updater is back and checking again.
  const [stalled] = await rows();
  await updater({ state: 'checked', running: { version: '1.1.0' } });
  const resolved = await resolve({ db: db(), user: harness.user as User, requestId: id() }, [
    stalled?.subjectId ?? '',
  ]);
  expect(resolved.get(stalled?.subjectId ?? '')?.title).toBe('1.1.0');
  await run(new Date(minutes(5)));
  expect(await rows()).toHaveLength(1);
});

it('ADMIN-B59 an update notification resolves to the version and the Updates page, for administrators only', async () => {
  const blocked = entry({
    state: 'blocked',
    step: 'guard',
    candidate: { version: '2.0.0', digest: 'sha256:four' },
    finishedAt: minutes(-1),
  });
  await updater(blocked, [blocked]);
  const subject = subjectId('blocked:sha256:four');
  expect(subject).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  const ctx = (user: User) => ({ db: db(), user, requestId: id() });
  const forAdmin = await resolve(ctx(harness.user as User), [subject]);
  expect(forAdmin.get(subject)).toEqual({ title: '2.0.0', href: '/admin/updates' });
  const member = await addUser('member', 'member@example.test');
  expect((await resolve(ctx(member), [subject])).size).toBe(0);
});

const digest = `sha256:${'b'.repeat(64)}`;
const auditOf = (action: string) =>
  db()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'updater'), eq(auditLog.action, action)));

it('ADMIN-B67 Install now leaves exactly the announced digest for the updater, audited', async () => {
  await updater({ state: 'available', candidate: { version: '2026.11.0', digest } });
  const sent = await admin.updateCommand(request('POST', { command: 'install', digest }));
  expect(sent.status).toBe(202);
  expect((await commandsLeft(current())).bodies).toEqual([
    { command: 'install', digest, confirm: false },
  ]);
  expect(await auditOf('update_install')).toHaveLength(1);
  for (const bad of [{ command: 'install' }, { command: 'install', digest: 'latest' }])
    expect((await admin.updateCommand(request('POST', bad))).status).toBe(400);
});

it('ADMIN-B67 a contract release needs the confirmation, and a paused updater installs nothing', async () => {
  await updater({ state: 'available', confirm: true, candidate: { digest } });
  const refused = await admin.updateCommand(request('POST', { command: 'install', digest }));
  expect(refused.status).toBe(422);
  expect((await commandsLeft(current())).files).toEqual([]);
  const confirmed = await admin.updateCommand(
    request('POST', { command: 'install', digest, confirm: true }),
  );
  expect(confirmed.status).toBe(202);
  await updater({ state: 'available', paused: true, candidate: { digest } });
  const paused = await admin.updateCommand(request('POST', { command: 'install', digest }));
  expect(paused.status).toBe(409);
  expect((await commandsLeft(current())).files).toEqual([]);
});

it('ADMIN-B68 turning automatic installing on or off reaches the updater and the audit log; members are refused', async () => {
  await updater({ state: 'checked' });
  for (const automatic of [true, false]) {
    const body = { command: 'settings', automatic, window: automatic ? '02:00-05:00' : '' };
    expect((await admin.updateCommand(request('POST', body))).status).toBe(202);
  }
  expect((await commandsLeft(current())).bodies).toEqual([
    { command: 'settings', automatic: true, window: '02:00-05:00' },
    { command: 'settings', automatic: false, window: '' },
  ]);
  const audit = await auditOf('update_settings');
  expect(audit.map((row) => row.diff)).toEqual(
    expect.arrayContaining([expect.objectContaining({ automatic: true, window: '02:00-05:00' })]),
  );
  expect(audit).toHaveLength(2);
  for (const window of ['2:00-05:00', '02:00-02:00', '02:00'])
    expect(
      (await admin.updateCommand(request('POST', { command: 'settings', automatic: true, window })))
        .status,
    ).toBe(400);
  session.user = await addUser('member', 'member@example.test');
  const member = await admin.updateCommand(
    request('POST', { command: 'settings', automatic: true, window: '' }),
  );
  expect(member.status).toBe(403);
  expect((await commandsLeft(current())).files).toHaveLength(2);
});

it('ADMIN-B67 ADMIN-B59 an announced release is one update.available for every active administrator, once', async () => {
  await addUser('member', 'member@example.test');
  const announced = entry({
    state: 'available',
    candidate: { version: '2026.11.0', digest },
    finishedAt: minutes(-2),
  });
  await updater(announced, [announced]);
  await lastRun(new Date(minutes(-5)));
  await run(now);
  const written = await rows();
  expect(written.map((row) => [row.userId, row.kind])).toEqual([
    [harness.user?.id, 'update.available'],
  ]);
  await run(new Date(minutes(5)));
  expect(await rows()).toHaveLength(1);
  const resolved = await resolve({ db: db(), user: harness.user as User, requestId: id() }, [
    written[0]?.subjectId ?? '',
  ]);
  expect(resolved.get(written[0]?.subjectId ?? '')).toEqual({
    title: '2026.11.0',
    href: '/admin/updates',
  });
});

it('ADMIN-B59 a status the updater writes queues the notification run at once, one for a burst', async () => {
  const unwatch = watchUpdates();
  try {
    await replaceStatus(current(), JSON.stringify(entry({ state: 'checking' })));
    await replaceStatus(current(), JSON.stringify(entry({ state: 'checked' })));
    const queued = () =>
      db()
        .select()
        .from(jobs)
        .where(and(eq(jobs.kind, updatesJob), eq(jobs.status, 'queued')));
    await vi.waitFor(async () => expect(await queued()).toHaveLength(1), {
      timeout: 5000,
      interval: 100,
    });
  } finally {
    unwatch();
  }
});
