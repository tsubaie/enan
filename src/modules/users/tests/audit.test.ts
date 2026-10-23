import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { id } from '@/core/db/ids';
import { auditLog } from '@/core/db/system-schema';
import { prune } from '@/core/db/jobs-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { User } from '@/core/http/user-schema';
import * as admin from '@/core/http/admin-api';
import { harness } from './fixtures';
import { midnightBoundaries } from '../../../../tests/fixtures/timezones';

// ADMIN-B72, ADMIN-B73: the audit log as the API narrows it, against entries written straight
// into the table so their actions, kinds and times are exactly the ones each scenario names.
const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('@/core/auth/session', async (original) => ({
  ...(await original<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

async function entry(action: string, entityType: string, createdAt = new Date()) {
  await db()
    .insert(auditLog)
    .values({ id: id(), actorId: null, action, entityType, entityId: null, diff: {}, createdAt });
}
async function read(query = '') {
  const url = new URL(`/api/v1/admin/audit${query ? `?${query}` : ''}`, env().APP_URL);
  const response = await admin.auditList(new Request(url));
  expect(response.status).toBe(200);
  const body: { data: { action: string; entityType: string }[] } = await response.json();
  return body.data.map((row) => `${row.action}:${row.entityType}`).sort();
}
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await harness.reset();
  session.user = harness.user;
});
afterAll(() => closeDatabase());

it('ADMIN-B72 all entries are the changes; sign-ins are their own kind, and a kind narrows the log', async () => {
  await entry('create', 'task');
  await entry('update', 'note');
  await entry('sign_in', 'session');
  await entry('sign_in_failed', 'session');
  expect(await read()).toEqual(['create:task', 'update:note']);
  expect(await read('type=sign_in')).toEqual(['sign_in:session', 'sign_in_failed:session']);
  expect(await read('type=tasks')).toEqual(['create:task']);
  expect(
    (await admin.auditList(new Request(new URL('/api/v1/admin/audit?type=x', env().APP_URL))))
      .status,
  ).toBe(400);
});

it('ADMIN-B73 what was done narrows the log by the same words the colours use, a removal first', async () => {
  await entry('create', 'task');
  await entry('delete', 'task');
  await entry('mail.settings.save', 'mail_settings');
  await entry('mail.settings.remove', 'mail_settings');
  await entry('account.password_changed', 'user');
  await entry('download', 'backup');
  expect(await read('change=removed')).toEqual([
    'delete:task',
    'mail.settings.remove:mail_settings',
  ]);
  expect(await read('change=added')).toEqual(['create:task']);
  expect(await read('change=changed')).toEqual([
    'account.password_changed:user',
    'mail.settings.save:mail_settings',
  ]);
});

it('ADMIN-B73 from and to are whole days in the workspace time zone, both included', async () => {
  const zone = midnightBoundaries[0];
  if (!zone) throw new Error('fixture');
  await withTransaction(db(), (database) =>
    writeSetting(database, 'workspace.timezone', zone.timezone, String(harness.user?.id)),
  );
  // A second either side of midnight there: the 7th's last moment and the 8th's first.
  await entry('update', 'task', new Date(zone.before));
  await entry('create', 'task', new Date(zone.after));
  expect(await read('from=2026-09-08&to=2026-09-08')).toEqual(['create:task']);
  expect(await read('to=2026-09-07')).toEqual(['update:task']);
  expect(await read('from=2026-09-07&to=2026-09-08')).toEqual(['create:task', 'update:task']);
});

it('ADMIN-B72 the nightly prune drops sign-ins older than thirty days and never a change', async () => {
  const old = new Date(Date.now() - 31 * 86400000);
  await entry('sign_in_failed', 'session', old);
  await entry('sign_in', 'session');
  await entry('delete', 'task', old);
  await prune(db());
  expect(await read('type=sign_in')).toEqual(['sign_in:session']);
  expect(await read()).toEqual(['delete:task']);
});
