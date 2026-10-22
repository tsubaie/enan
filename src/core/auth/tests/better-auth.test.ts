import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import journal from '../../../../drizzle/meta/_journal.json';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser, lockWorkspace } from '@/core/db/auth-repo';
import { saveMailSettings } from '@/core/db/mail-settings-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { loginAttempts, users } from '@/core/db/system-schema';
import { authSessions, authVerifications } from '@/core/db/auth-schema';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
// The real Better Auth handler on the test database; only Next's request scope and the SMTP
// client are stood in for. `after` runs its work at once, so a mailed code is observable.
const io = vi.hoisted(() => ({
  sent: [] as { text: string; to: string }[],
  later: [] as Promise<void>[],
}));
vi.mock('next/server', () => ({
  after: (work: () => Promise<void>) => io.later.push(Promise.resolve().then(work)),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: { text: string; to: string }) => {
        io.sent.push(message);
      },
      close: () => {},
    }),
  },
}));
const verified = vi.hoisted(() => ({ hashes: [] as string[] }));
vi.mock('../password', async (original) => {
  const actual = await original<typeof import('../password')>();
  return {
    ...actual,
    verifyPassword: (hash: string, value: string) => {
      verified.hashes.push(hash);
      return actual.verifyPassword(hash, value);
    },
    // Better Auth answers an unknown address by hashing the password, at the same argon2 cost.
    hashPassword: (value: string) => {
      verified.hashes.push('hash');
      return actual.hashPassword(value);
    },
  };
});
// The Google client read can be made to fail once, the way a passing database error would.
const google = vi.hoisted(() => ({ failNext: false }));
vi.mock('../google-settings', async (original) => {
  const actual = await original<typeof import('../google-settings')>();
  return {
    ...actual,
    googleClient: (database: Parameters<typeof actual.googleClient>[0]) => {
      if (!google.failNext) return actual.googleClient(database);
      google.failNext = false;
      return Promise.reject(new Error('database is locked'));
    },
  };
});
const { auth, resetAuth } = await import('../better-auth');
const { saveGoogle } = await import('../google-settings');
const { hashPassword } = await import('../password');
const password = 'correct-horse-battery-staple';
let passwordHash = '';
let member = '';
async function addUser(email: string, isActive = true) {
  return withTransaction(db(), async (database) => {
    await lockWorkspace(database);
    return insertUser(database, {
      id: id(),
      name: email,
      email,
      passwordHash,
      role: 'member',
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
const choose = (methods: ('password' | 'code' | 'google')[]) =>
  withTransaction(db(), (database) =>
    writeSetting(database, 'auth.sign_in_methods', methods, member),
  );
function call(path: string, body: object, headers: Record<string, string> = {}) {
  return auth().then((instance) =>
    instance.handler(
      new Request(new URL(`/api/auth${path}`, env().APP_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: env().APP_URL,
          'X-Requested-With': 'Enan',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    ),
  );
}
const signIn = (email: string, secret = password) =>
  call('/sign-in/email', { email, password: secret });
beforeAll(async () => {
  await migrateDatabase();
  passwordHash = await hashPassword(password);
});
// The suite's own hashing above is not a sign-in attempt.
beforeEach(async () => {
  io.sent = [];
  io.later = [];
  resetAuth();
  await clearDatabase();
  member = (await addUser('member@example.test')).id;
  verified.hashes = [];
});
afterAll(() => closeDatabase());

it('ADMIN-B66 a password saved before Better Auth still signs in, and the session cookie is Enan’s', async () => {
  const response = await signIn('Member@Example.test');
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toMatch(/enan\.session_token=/u);
  const rows = await db().select().from(authSessions).where(eq(authSessions.userId, member));
  expect(rows).toHaveLength(1);
});
it('ADMIN-B21 a wrong password, an unknown address and a deactivated account are refused alike, each after one argon2 verification', async () => {
  await addUser('former@example.test', false);
  expect((await signIn('member@example.test', 'wrong-password')).status).toBe(401);
  expect((await signIn('nobody@example.test')).status).toBe(401);
  expect((await signIn('former@example.test')).status).toBe(401);
  expect(verified.hashes).toHaveLength(3);
  expect(verified.hashes[1]).toBe('hash');
  expect(await db().select().from(authSessions)).toHaveLength(0);
});
it('ADMIN-B20 five failures close the email bucket, and a sixth attempt is refused even with the right password', async () => {
  for (let attempt = 0; attempt < 5; attempt++)
    expect((await signIn('member@example.test', 'wrong-password')).status).toBe(401);
  expect((await signIn('member@example.test')).status).toBe(429);
});
it('ADMIN-B64 state-changing calls need the header, and a method that is off is refused', async () => {
  expect(
    (
      await call(
        '/sign-in/email',
        { email: 'member@example.test', password },
        { 'X-Requested-With': '' },
      )
    ).status,
  ).toBe(403);
  // Codes are chosen but mail is not set up, so password comes back rather than leaving no way in.
  await choose(['code']);
  expect((await signIn('member@example.test')).status).toBe(200);
  await mailReady();
  expect((await signIn('member@example.test')).status).toBe(403);
});
it('ADMIN-B63 a code is mailed after the reply to a member only, the reply is the same for a stranger, and it signs in once', async () => {
  await mailReady();
  const known = await call('/email-otp/send-verification-otp', {
    email: 'member@example.test',
    type: 'sign-in',
  });
  const unknown = await call('/email-otp/send-verification-otp', {
    email: 'nobody@example.test',
    type: 'sign-in',
  });
  expect(known.status).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
  await Promise.all(io.later);
  expect(io.sent.map((mail) => mail.to)).toEqual(['member@example.test']);
  const code = /\b(\d{6})\b/u.exec(io.sent[0]?.text ?? '')?.[1] ?? '';
  // Better Auth keeps the code hashed, never the six digits.
  expect(JSON.stringify(await db().select().from(authVerifications))).not.toContain(code);
  expect(
    (await call('/sign-in/email-otp', { email: 'member@example.test', otp: code })).status,
  ).toBe(200);
  expect(
    (await call('/sign-in/email-otp', { email: 'member@example.test', otp: code })).status,
  ).not.toBe(200);
});
it('ADMIN-B63 code requests are throttled per email the same way for a stranger', async () => {
  await mailReady();
  for (const email of ['member@example.test', 'nobody@example.test']) {
    for (let send = 0; send < 3; send++)
      expect(
        (await call('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status,
      ).toBe(200);
    expect(
      (await call('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status,
    ).toBe(429);
  }
});
it('ADMIN-B66 nobody can sign themselves up', async () => {
  const response = await call('/sign-up/email', {
    email: 'new@example.test',
    password,
    name: 'New',
  });
  expect(response.status).toBe(404);
  expect(await db().select().from(users)).toHaveLength(1);
});
it('ACCT-B04 signing in sets the language the reader chose, and leaves the cookie alone without one', async () => {
  expect((await signIn('member@example.test')).headers.get('set-cookie')).not.toMatch(
    /eos_locale/u,
  );
  await writeSetting(db(), 'user.locale', 'ar', member, member);
  expect((await signIn('member@example.test')).headers.get('set-cookie')).toMatch(/eos_locale=ar/u);
});
// Migration 0012's own data statements, on a member written the way the release before it did:
// a password hash on the row and no credential account.
it('ADMIN-B66 migration 0012 carries a password from before Better Auth over, so it signs in unchanged', async () => {
  const before = id();
  await db().insert(users).values({
    id: before,
    name: 'Before',
    email: 'before@example.test',
    passwordHash,
    role: 'member',
  });
  expect((await signIn('before@example.test')).status).toBe(401);
  const index = journal.entries.findIndex((entry) => entry.tag === '0012_better_auth');
  const statements = readMigrationFiles({ migrationsFolder: './drizzle' })[index]?.sql ?? [];
  for (const statement of statements.filter((text) => /^\s*(INSERT|UPDATE)/u.test(text)))
    await db().run(sql.raw(statement));
  expect((await signIn('before@example.test')).status).toBe(200);
  const [row] = await db().select().from(users).where(eq(users.id, before));
  expect(row?.emailVerified).toBe(true);
  // Run again, it adds nothing: the member already has a credential account.
  for (const statement of statements.filter((text) => /^\s*INSERT/u.test(text)))
    await db().run(sql.raw(statement));
  expect((await signIn('before@example.test')).status).toBe(200);
});

const startGoogle = () =>
  call('/sign-in/social', { provider: 'google', callbackURL: '/home', errorCallbackURL: '/login' });
it('ADMIN-B65 a saved Google client takes effect once Better Auth is rebuilt, and a failed read is not kept', async () => {
  await withTransaction(db(), (database) =>
    saveGoogle(database, member, {
      clientId: '1234-test.apps.googleusercontent.com',
      clientSecret: 'fixture-google-secret',
    }),
  );
  // The first build cannot read the client, so it has no Google; the next request builds again.
  google.failNext = true;
  expect((await startGoogle()).status).not.toBe(200);
  const started = await startGoogle();
  expect(started.status).toBe(200);
  expect(new URL(((await started.json()) as { url: string }).url).host).toBe('accounts.google.com');
});
it('ADMIN-B20 a sign-in turned away because the hasher is busy (429) is not counted as a wrong password', async () => {
  const replies = await Promise.all([1, 2, 3].map(() => signIn('member@example.test')));
  expect(replies.map((reply) => reply.status).sort()).toEqual([200, 200, 429]);
  const failed = await db()
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, 'member@example.test'), eq(loginAttempts.succeeded, false)));
  expect(failed).toHaveLength(0);
});
