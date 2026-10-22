import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser, lockWorkspace } from '@/core/db/auth-repo';
import { saveMailSettings } from '@/core/db/mail-settings-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { signInCodes, users } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { requestCode, signInWithCode } from '../code';
import { login, recover } from '../login';
import { signInMethods } from '../methods';
import { hashPassword } from '../password';
import { env } from '@/core/config/env';
import { updateSetting } from '@/modules/settings';
import { User } from '@/core/http/user-schema';
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
const mailReady = () =>
  withTransaction(db(), (database) =>
    saveMailSettings(database, {
      host: 'smtp.example.test',
      port: 587,
      username: '',
      encryptedPassword: null,
      fromAddress: 'office@example.test',
    }),
  );
// Settings name the member who wrote them, so the first account stands in as the author.
async function choose(methods: ('password' | 'code' | 'google')[]) {
  const [author] = await db().select({ id: users.id }).from(users).limit(1);
  if (!author) throw new Error('no account to write the setting');
  await withTransaction(db(), (database) =>
    writeSetting(database, 'auth.sign_in_methods', methods, author.id),
  );
}
const ask = (email: string, ip: string | null = '203.0.113.1') => requestCode(db(), email, ip);
const use = (email: string, code: string, ip: string | null = '203.0.113.1') =>
  signInWithCode(db(), { email, code }, ip);
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
beforeAll(async () => {
  await migrateDatabase();
  passwordHash = await hashPassword(password);
});
beforeEach(async () => {
  await clearDatabase();
  await mailReady();
});
afterAll(() => closeDatabase());

it('ADMIN-B63 only an active account gets a code, yet every request is answered and recorded alike', async () => {
  await addUser('member@example.test');
  await addUser('former@example.test', false);
  const issued = await ask('member@example.test');
  expect(issued?.user.email).toBe('member@example.test');
  expect(issued?.code).toMatch(/^\d{6}$/u);
  expect(await ask('nobody@example.test')).toBeNull();
  expect(await ask('former@example.test')).toBeNull();
  const rows = await db().select().from(signInCodes);
  expect(rows).toHaveLength(3);
  // The digits are never stored: only an HMAC bound to the row, for the active account alone.
  expect(JSON.stringify(rows)).not.toContain(`"${issued?.code}"`);
  expect(rows.filter((row) => row.codeHash !== null)).toHaveLength(1);
});
it('ADMIN-B63 sending is throttled per email and per address the same way for unknown emails', async () => {
  await addUser('member@example.test');
  for (const email of ['member@example.test', 'nobody@example.test']) {
    for (let send = 0; send < 3; send++) await ask(email, null);
    await expect(ask(email, null)).rejects.toMatchObject({
      code: 'rate_limited',
      details: { scope: 'sign_in_code' },
    });
  }
  for (let send = 0; send < 10; send++) await ask(`spray${send}@example.test`, '198.51.100.7');
  await expect(ask('member@example.test', '198.51.100.7')).rejects.toMatchObject({
    code: 'rate_limited',
  });
});
it('ADMIN-B63 a code signs in once, and a newer code replaces it', async () => {
  await addUser('member@example.test');
  const first = await ask('member@example.test');
  const second = await ask('member@example.test');
  if (!first || !second) throw new Error('no code issued');
  if (first.code !== second.code)
    await expect(use('member@example.test', first.code)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  const session = await use('member@example.test', second.code);
  expect(session.user.email).toBe('member@example.test');
  expect(session.token).toMatch(/^[0-9a-f]{64}$/u);
  await expect(use('member@example.test', second.code)).rejects.toMatchObject({
    code: 'unauthenticated',
  });
});
it('ADMIN-B63 five wrong guesses use the code up, and each counts as a failed login', async () => {
  await addUser('member@example.test');
  const issued = await ask('member@example.test');
  if (!issued) throw new Error('no code issued');
  for (let guess = 0; guess < 4; guess++)
    await expect(use('member@example.test', wrong(issued.code), null)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  // The fifth wrong guess also reaches the login throttle's five failures for this email.
  await expect(use('member@example.test', wrong(issued.code), null)).rejects.toMatchObject({
    code: 'unauthenticated',
  });
  await expect(use('member@example.test', issued.code, null)).rejects.toMatchObject({
    code: 'rate_limited',
    details: { scope: 'login' },
  });
  const [row] = await db().select().from(signInCodes);
  expect(row?.attempts).toBe(5);
});
it('ADMIN-B63 an expired code, or one for an account deactivated since, does not sign in', async () => {
  const member = await addUser('member@example.test');
  const issued = await ask('member@example.test');
  if (!issued) throw new Error('no code issued');
  await db()
    .update(signInCodes)
    .set({ expiresAt: new Date(Date.now() - 1000) });
  await expect(use('member@example.test', issued.code)).rejects.toMatchObject({
    code: 'unauthenticated',
  });
  const again = await ask('member@example.test');
  if (!again) throw new Error('no code issued');
  await db().update(users).set({ isActive: false }).where(eq(users.id, member.id));
  await expect(use('member@example.test', again.code)).rejects.toMatchObject({
    code: 'unauthenticated',
  });
});
it('ADMIN-B64 codes are refused while the method is off or mail is not set up', async () => {
  await addUser('member@example.test');
  await choose(['password']);
  await expect(ask('member@example.test')).rejects.toMatchObject({
    code: 'forbidden',
    details: { reason: 'sign_in_method' },
  });
  await choose(['password', 'code']);
  await clearDatabase();
  await addUser('member@example.test');
  await expect(ask('member@example.test')).rejects.toMatchObject({ code: 'forbidden' });
});
it('ADMIN-B64 with password sign-in off the API refuses it, and the recovery token still works', async () => {
  const admin = await addUser('admin@example.test');
  await choose(['code']);
  expect((await signInMethods(db())).enabled).toEqual(['code']);
  await expect(login(db(), { email: admin.email, password }, null)).rejects.toMatchObject({
    code: 'forbidden',
    details: { reason: 'sign_in_method' },
  });
  await recover(
    db(),
    { email: admin.email, password: 'a-brand-new-password-1', token: env().RECOVERY_TOKEN ?? '' },
    null,
  );
});
it('ADMIN-B64 if every chosen method stops being servable, password sign-in comes back', async () => {
  await addUser('admin@example.test');
  await choose(['code']);
  await clearDatabase();
  const admin = await addUser('admin@example.test');
  await choose(['code']);
  expect((await signInMethods(db())).enabled).toEqual(['password']);
  expect((await login(db(), { email: admin.email, password }, null)).user.id).toBe(admin.id);
});
it('ADMIN-B64 an administrator can only choose methods the server can serve, and at least one', async () => {
  const admin = await addUser('admin@example.test');
  const ctx = { user: User.parse(admin), db: db(), requestId: id() };
  await expect(updateSetting(ctx, 'auth.sign_in_methods', [])).rejects.toThrow();
  // The default chooses every method, so one not yet servable may stay chosen while another
  // changes, but cannot be switched back on once it was switched off.
  await updateSetting(ctx, 'auth.sign_in_methods', ['code', 'google']);
  expect((await signInMethods(db())).enabled).toEqual(['code']);
  await updateSetting(ctx, 'auth.sign_in_methods', ['code']);
  await expect(
    updateSetting(ctx, 'auth.sign_in_methods', ['code', 'google']),
  ).rejects.toMatchObject({
    code: 'rule_violation',
    details: { reason: 'sign_in_method_unavailable', methods: ['google'] },
  });
  expect((await signInMethods(db())).chosen).toEqual(['code']);
});
