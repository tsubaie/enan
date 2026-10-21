import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { migrateDatabase } from '@/core/db/migrate';
import { clearDatabase } from '@/core/db/reset';
import { insertUser } from '@/core/db/auth-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { User } from '@/core/http/user-schema';
const reader = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  user: null as object | null,
}));
vi.mock('next-intl/server', () => ({ getRequestConfig: (config: () => object) => config }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (reader.cookie ? { value: reader.cookie } : undefined) }),
}));
vi.mock('@/core/auth/session', () => ({ currentUser: async () => reader.user }));
const { default: config } = await import('../request');
const localeNow = async () => (await config({ requestLocale: Promise.resolve(undefined) })).locale;
let id = '';
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  await clearDatabase();
  id = crypto.randomUUID();
  const row = await insertUser(db(), {
    id,
    email: 'reader@example.test',
    name: 'Reader',
    passwordHash: 'x',
    role: 'member',
  });
  reader.user = User.parse(row);
  reader.cookie = undefined;
});
afterAll(() => closeDatabase());
it('ACCT-B04 with no cookie the page follows the reader, then the workspace; a cookie wins', async () => {
  await writeSetting(db(), 'workspace.default_locale', 'ar', id);
  expect(await localeNow()).toBe('ar');
  await writeSetting(db(), 'user.locale', 'en', id, id);
  expect(await localeNow()).toBe('en');
  reader.user = null;
  expect(await localeNow()).toBe('ar');
  reader.cookie = 'en';
  expect(await localeNow()).toBe('en');
});
