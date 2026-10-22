import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser, lockWorkspace } from '@/core/db/auth-repo';
import { User } from '@/core/http/user-schema';
import { env } from '@/core/config/env';
import { googleRead, googleRemove, googleSave } from '../api';
const session = vi.hoisted(() => ({ role: 'admin', id: '' }));
vi.mock('@/core/auth/session', () => ({
  currentUser: async () =>
    User.parse({
      id: session.id,
      role: session.role,
      email: 'admin@example.test',
      name: 'Admin',
      isActive: true,
      revision: 1,
    }),
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
// Outside a Next request, the work `after` would run once the response is sent runs at once.
vi.mock('next/server', () => ({ after: (work: () => void) => work() }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  session.role = 'admin';
  await clearDatabase();
  session.id = await withTransaction(db(), async (database) => {
    await lockWorkspace(database);
    const user = await insertUser(database, {
      id: '0190a0a0-0000-7000-8000-000000000002',
      name: 'Admin',
      email: 'admin@example.test',
      passwordHash: 'unused',
      role: 'admin',
    });
    return user.id;
  });
});
afterAll(() => closeDatabase());
const client = { clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'fixture-secret' };
const request = (method: string, body?: object) =>
  new Request(new URL('/api/v1/admin/sign-in/google', env().APP_URL), {
    method,
    headers: { Origin: env().APP_URL, 'X-Requested-With': 'Enan' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

it('ADMIN-B65 members cannot read, save or remove the Google client', async () => {
  session.role = 'member';
  expect((await googleRead(request('GET'))).status).toBe(403);
  expect((await googleSave(request('PUT', client))).status).toBe(403);
  expect((await googleRemove(request('DELETE', {}))).status).toBe(403);
});
it('ADMIN-B65 the admin API saves the client without echoing its secret', async () => {
  const saved = await googleSave(request('PUT', client));
  expect(saved.status).toBe(200);
  const body = JSON.stringify(await saved.json());
  expect(body).toContain(client.clientId);
  expect(body).not.toContain(client.clientSecret);
  expect((await googleRemove(request('DELETE', {}))).status).toBe(200);
});
