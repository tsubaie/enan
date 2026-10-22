import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser, lockWorkspace } from '@/core/db/auth-repo';
import { saveMailSettings } from '@/core/db/mail-settings-repo';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
const work = vi.hoisted(() => ({ later: [] as (() => Promise<void>)[], sent: [] as object[] }));
vi.mock('next/server', () => ({ after: (task: () => Promise<void>) => work.later.push(task) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: object) => {
        work.sent.push(message);
      },
      close: () => {},
    }),
  },
}));
const { codeRequestApi, codeSignInApi } = await import('../api');
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  work.later = [];
  work.sent = [];
  await clearDatabase();
  await withTransaction(db(), async (database) => {
    await lockWorkspace(database);
    await insertUser(database, {
      id: id(),
      name: 'Member',
      email: 'member@example.test',
      passwordHash: 'unused',
      role: 'member',
    });
    await saveMailSettings(database, {
      host: 'smtp.example.test',
      port: 587,
      username: '',
      encryptedPassword: null,
      fromAddress: 'office@example.test',
    });
  });
});
afterAll(() => closeDatabase());
const post = (path: string, body: object) =>
  new Request(new URL(`/api/v1/auth/${path}`, env().APP_URL), {
    method: 'POST',
    headers: { Origin: env().APP_URL, 'X-Requested-With': 'Enan' },
    body: JSON.stringify(body),
  });

it('ADMIN-B63 the reply is the same for a member and a stranger, and the code is mailed after it', async () => {
  const known = await codeRequestApi(post('code', { email: 'Member@Example.test' }));
  const unknown = await codeRequestApi(post('code', { email: 'stranger@example.test' }));
  expect(known.status).toBe(200);
  expect(unknown.status).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
  // Nothing is sent while the request is answered; only the member's request leaves work behind.
  expect(work.sent).toHaveLength(0);
  expect(work.later).toHaveLength(1);
  await work.later[0]?.();
  expect(work.sent).toHaveLength(1);
  const mail = work.sent[0];
  expect(mail).toMatchObject({ to: 'member@example.test' });
  const code = /\b(\d{6})\b/u.exec(JSON.stringify(mail))?.[1] ?? '';
  const signedIn = await codeSignInApi(post('code/verify', { email: 'member@example.test', code }));
  expect(signedIn.status).toBe(200);
  const reused = await codeSignInApi(post('code/verify', { email: 'member@example.test', code }));
  expect(reused.status).toBe(401);
});
it('ADMIN-B63 a code must be six digits', async () => {
  const response = await codeSignInApi(
    post('code/verify', { email: 'member@example.test', code: '12345' }),
  );
  expect(response.status).toBe(400);
});
