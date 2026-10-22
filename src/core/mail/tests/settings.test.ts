import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { readMailSettings, saveMailSettings } from '@/core/db/mail-settings-repo';
import { auditEntries } from '@/core/db/admin-repo';
import { id } from '@/core/db/ids';
import { User } from '@/core/http/user-schema';
import { seal } from '@/core/auth/sealed';
import { redact } from '@/core/config/redact';
import { mailServer, mailStatus, removeMail, saveMail } from '../settings';
import { read, save, remove, test } from '@/core/http/mail-api';
const overrides = vi.hoisted(() => ({ value: {} as Record<string, string | number> }));
vi.mock('@/core/config/env', async (original) => {
  const actual = await original<typeof import('@/core/config/env')>();
  return { ...actual, env: () => ({ ...actual.env(), ...overrides.value }) };
});
const session = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/core/auth/session', () => ({
  currentUser: async () =>
    User.parse({
      id: '0190a0a0-0000-7000-8000-000000000001',
      role: session.role,
      email: 'admin@example.test',
      name: 'Admin',
      isActive: true,
      revision: 1,
    }),
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  overrides.value = {};
  session.role = 'admin';
  await clearDatabase();
});
afterAll(() => closeDatabase());
const server = {
  host: 'smtp.example.test',
  port: 587,
  username: 'sender@example.test',
  password: 'fixture-mail-password',
  fromAddress: 'office@example.test',
};
const write = (input: object) => withTransaction(db(), (tx) => saveMail(tx, id(), input));

it('ADMIN-B60 saves the mail server with its password sealed and never returns the password', async () => {
  const status = await write(server);
  expect(status).toEqual({
    source: 'saved',
    host: server.host,
    port: 587,
    username: server.username,
    fromAddress: server.fromAddress,
    hasPassword: true,
  });
  const stored = await readMailSettings(db());
  expect(stored?.encryptedPassword).toMatch(/^v1\./u);
  expect(JSON.stringify(stored)).not.toContain(server.password);
  expect(JSON.stringify(await auditEntries(db()))).not.toContain(server.password);
  expect(await mailServer(db())).toEqual(server);
  expect(redact({ SMTP_PASSWORD: 'x', encryptedPassword: 'y' })).toEqual({
    SMTP_PASSWORD: '[redacted]',
    encryptedPassword: '[redacted]',
  });
});
it('ADMIN-B60 a blank password keeps the saved one, also when the host it is bound to changes', async () => {
  await write(server);
  await write({ ...server, host: 'mail.example.test', password: '' });
  expect((await mailServer(db()))?.password).toBe(server.password);
  await write({ ...server, password: 'replacement-password' });
  expect((await mailServer(db()))?.password).toBe('replacement-password');
  await write({ ...server, username: '', password: undefined });
  expect((await mailServer(db()))?.password).toBe('replacement-password');
});
it('ADMIN-B60 a sealed password moved to another server or sealed under another secret fails closed', async () => {
  await withTransaction(db(), (tx) =>
    saveMailSettings(tx, {
      host: 'other.example.test',
      port: 587,
      username: server.username,
      fromAddress: server.fromAddress,
      encryptedPassword: seal(
        server.password,
        'mail-credentials-v1',
        `${server.host}\n${server.username}`,
      ),
    }),
  );
  await expect(mailServer(db())).rejects.toMatchObject({
    code: 'mail_failed',
    details: { reason: 'credentials' },
  });
  // Saving again without a password drops the one that cannot be opened rather than keeping it.
  await write({ ...server, host: 'other.example.test', password: '' });
  expect((await mailServer(db()))?.password).toBeNull();
});
it('ADMIN-B60 the server variables apply until a server is saved, and again once it is removed', async () => {
  expect((await mailStatus(db())).source).toBe('none');
  expect(await mailServer(db())).toBeNull();
  overrides.value = {
    SMTP_HOST: 'env.example.test',
    SMTP_PORT: 465,
    SMTP_USER: 'env-user',
    SMTP_PASSWORD: 'env-password',
    MAIL_FROM: 'env@example.test',
  };
  expect(await mailStatus(db())).toEqual({
    source: 'environment',
    host: 'env.example.test',
    port: 465,
    username: 'env-user',
    fromAddress: 'env@example.test',
    hasPassword: true,
  });
  await write(server);
  expect((await mailServer(db()))?.host).toBe(server.host);
  await withTransaction(db(), (tx) => removeMail(tx, id()));
  expect((await mailServer(db()))?.password).toBe('env-password');
});
it('ADMIN-B60 refuses a host that is not a server name and an invalid sender', async () => {
  await expect(write({ ...server, host: 'smtp.example.test:25' })).rejects.toThrow();
  await expect(write({ ...server, host: 'https://smtp.example.test' })).rejects.toThrow();
  await expect(write({ ...server, fromAddress: 'office' })).rejects.toThrow();
  await expect(write({ ...server, port: 0 })).rejects.toThrow();
});
function request(path: string, method: string, body?: object) {
  return new Request(new URL(`/api/v1/admin/mail${path}`, 'http://localhost:3000'), {
    method,
    headers: { Origin: 'http://localhost:3000', 'X-Requested-With': 'Enan' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it('ADMIN-B60 members cannot read, save, remove or test the mail server', async () => {
  session.role = 'member';
  expect((await read(request('', 'GET'))).status).toBe(403);
  expect((await save(request('', 'PUT', server))).status).toBe(403);
  expect((await remove(request('', 'DELETE', {}))).status).toBe(403);
  expect((await test(request('/test', 'POST', {}))).status).toBe(403);
});
it('ADMIN-B60 the admin API saves and removes the server without echoing the password', async () => {
  const saved = await save(request('', 'PUT', server));
  expect(saved.status).toBe(200);
  expect(JSON.stringify(await saved.json())).not.toContain(server.password);
  expect(((await (await read(request('', 'GET'))).json()) as { data: object }).data).toMatchObject(
    {
      source: 'saved',
      hasPassword: true,
    },
  );
  expect((await remove(request('', 'DELETE', {}))).status).toBe(200);
  expect(await readMailSettings(db())).toBeUndefined();
});
it('ADMIN-B61 a test with no mail server configured is refused, not attempted', async () => {
  const response = await test(request('/test', 'POST', {}));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    error: { details: { reason: 'mail_not_configured' } },
  });
});
