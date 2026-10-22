import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser, lockWorkspace, recordLogin } from '@/core/db/auth-repo';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
// The recovery route exists only when RECOVERY_TOKEN is configured; the suite reads the value the
// test environment was given rather than setting one, because env.ts owns environment access.
const recoveryToken = env().RECOVERY_TOKEN ?? '';
// ADR 0055: Better Auth makes the attempts (better-auth.test.ts); the buckets they fill are the
// throttle's, driven here with recorded failures so each bucket can be set exactly.
const { throttle, recover } = await import('../login');
const { hashPassword } = await import('../password');
const password = 'correct-horse-battery-staple';
let passwordHash = '';
async function addUser(email: string, isActive = true) {
  return withTransaction(db(), async (database) => {
    await lockWorkspace(database);
    return insertUser(database, {
      id: id(),
      name: email,
      email,
      passwordHash,
      role: 'admin',
      isActive,
    });
  });
}
const fail = (email: string, ip: string | null) => recordLogin(db(), email, ip, false);
const login = (_database: object, input: { email: string; password: string }, ip: string | null) =>
  throttle(db(), input.email, ip).then(() => ({ user: { email: input.email } }));
beforeAll(async () => {
  await migrateDatabase();
  passwordHash = await hashPassword(password);
});
beforeEach(async () => {
  await clearDatabase();
});
afterAll(() => closeDatabase());

it('ADMIN-B20 an unresolved client address never shares one throttling bucket across accounts', async () => {
  await addUser('locked@example.test');
  await addUser('bystander@example.test');
  for (let attempt = 0; attempt < 5; attempt++) await fail('locked@example.test', null);
  await expect(login(db(), { email: 'locked@example.test', password }, null)).rejects.toMatchObject(
    {
      code: 'rate_limited',
      details: { scope: 'login' },
    },
  );
  // Without a trusted proxy the address is unknown, so it must not become a shared bucket that
  // five failures anywhere can exhaust for the whole installation.
  const session = await login(db(), { email: 'bystander@example.test', password }, null);
  expect(session.user.email).toBe('bystander@example.test');
});

it('ADMIN-B20 per-email and per-address failures are counted as independent buckets', async () => {
  await addUser('target@example.test');
  for (let attempt = 0; attempt < 3; attempt++) await fail('target@example.test', '10.0.0.1');
  for (let attempt = 0; attempt < 2; attempt++) await fail('other@example.test', '203.0.113.9');
  // Three failures on the email and two on the address are each under the threshold; only their
  // union reaches five, and a union is not a limit anybody configured.
  const session = await login(db(), { email: 'target@example.test', password }, '203.0.113.9');
  expect(session.user.email).toBe('target@example.test');
});

it('ADMIN-B20 five failures from one address throttle that address independently of the email', async () => {
  await addUser('first@example.test');
  await addUser('second@example.test');
  for (let attempt = 0; attempt < 5; attempt++)
    await fail(`spray${attempt}@example.test`, '203.0.113.9');
  await expect(
    login(db(), { email: 'first@example.test', password }, '203.0.113.9'),
  ).rejects.toMatchObject({ code: 'rate_limited', details: { scope: 'login' } });
  const session = await login(db(), { email: 'second@example.test', password }, '198.51.100.4');
  expect(session.user.email).toBe('second@example.test');
});

it('ADMIN-B22 recovery attempts are throttled by client address and stay single-use', async () => {
  const admin = await addUser('admin@example.test');
  const attempt = (token: string, ip: string | null) =>
    recover(db(), { email: admin.email, password: 'a-brand-new-password-1', token }, ip);
  for (let index = 0; index < 5; index++)
    await expect(attempt('wrong-token', '203.0.113.9')).rejects.toMatchObject({
      code: 'forbidden',
    });
  await expect(attempt(recoveryToken, '203.0.113.9')).rejects.toMatchObject({
    code: 'rate_limited',
    details: { scope: 'login' },
  });
  await expect(attempt(recoveryToken, '198.51.100.4')).resolves.toBeUndefined();
  await expect(attempt(recoveryToken, '198.51.100.4')).rejects.toMatchObject({ code: 'conflict' });
});
