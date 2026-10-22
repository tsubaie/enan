import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { env } from '@/core/config/env';
import { insertUser, insertSession } from '@/core/db/auth-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { users, sessions, settings } from '@/core/db/system-schema';
import { hashPassword } from '@/core/auth/password';
import { User } from '@/core/http/user-schema';
import { id } from '@/core/db/ids';
import * as api from '../api';
import { readerTheme } from '../service';
// The handlers are exercised as the route files export them, with a real Request and the real
// database. The session is the one seam that is replaced: the cookie is what a request knows about
// itself, so the scenarios say which account and which device the request arrives from.
const session = vi.hoisted(() => ({
  user: null as User | null,
  hash: 'hash-holder-current',
  localeCookie: null as string | null,
}));
vi.mock('@/core/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  currentUser: async () => session.user,
  currentSessionHash: async () => session.hash,
  setLocaleCookie: async (locale: string) => {
    session.localeCookie = locale;
  },
}));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
type Meta = { guard: string; status: number; idempotent: boolean };
const meta = (handler: { meta: Meta }) => ({
  guard: handler.meta.guard,
  status: handler.meta.status,
  idempotent: handler.meta.idempotent,
});
type Handler = (
  request: Request,
  route?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Options = {
  key?: string;
  origin?: string;
  requestedWith?: string | null;
  params?: Record<string, string>;
};
async function call(
  handler: Handler,
  method: string,
  path = '',
  body?: object | string,
  options: Options = {},
) {
  const headers: Record<string, string> = {
    Origin: options.origin ?? env().APP_URL,
    'Content-Type': 'application/json',
    'Idempotency-Key': options.key ?? crypto.randomUUID(),
  };
  if (options.requestedWith !== null)
    headers['X-Requested-With'] = options.requestedWith ?? 'Enan';
  const request = new Request(new URL(`/api/v1/account${path}`, env().APP_URL), {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const response = await handler(
    request,
    options.params ? { params: Promise.resolve(options.params) } : undefined,
  );
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const PASSWORD = 'correct horse battery';
let passwordHash: string;
let holder: User;
let member: User;
let holderOther: string;
let memberSession: string;
async function session_(userId: string, tokenHash: string) {
  const sessionId = id();
  const now = new Date();
  await insertSession(db(), {
    id: sessionId,
    userId,
    tokenHash,
    issuedAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    absoluteExpiresAt: new Date(now.getTime() + 86_400_000),
    ip: '203.0.113.7',
    userAgent: `Agent ${tokenHash}`,
  });
  return sessionId;
}
const live = (userId: string) =>
  db()
    .select({ tokenHash: sessions.tokenHash, revokedAt: sessions.revokedAt })
    .from(sessions)
    .where(eq(sessions.userId, userId));
const userRow = async (userId: string) =>
  (await db().select().from(users).where(eq(users.id, userId)))[0];
beforeAll(async () => {
  await migrateDatabase();
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(async () => {
  await clearDatabase();
  holder = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Account Holder',
      email: 'holder@example.test',
      passwordHash,
      role: 'admin',
    }),
  );
  member = User.parse(
    await insertUser(db(), {
      id: id(),
      name: 'Plain Member',
      email: 'member@example.test',
      passwordHash: 'unused',
      role: 'member',
    }),
  );
  await session_(holder.id, 'hash-holder-current');
  holderOther = await session_(holder.id, 'hash-holder-other');
  memberSession = await session_(member.id, 'hash-member');
  session.user = holder;
  session.hash = 'hash-holder-current';
});
afterAll(() => closeDatabase());

it('ACCT-B01 ACCT-B02 ACCT-B03 ACCT-B06 every account endpoint is session guarded and every write is idempotent', () => {
  expect(meta(api.detail)).toEqual({ guard: 'session', status: 200, idempotent: false });
  expect(meta(api.patch)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.email)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.password)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.revokeOthers)).toEqual({ guard: 'session', status: 200, idempotent: true });
  expect(meta(api.revokeOne)).toEqual({ guard: 'session', status: 200, idempotent: true });
});

it('ACCT-I01 no endpoint takes a user id, in the body or in the query', async () => {
  for (const handler of [
    api.detail,
    api.patch,
    api.email,
    api.password,
    api.revokeOthers,
    api.revokeOne,
  ])
    for (const key of ['userId', 'user_id', 'id'])
      expect(handler.meta.input.safeParse({ revision: 1, [key]: member.id }).success).toBe(false);
  // The read takes its input from the query string, and an unknown parameter is refused rather
  // than ignored, so there is no way to even ask for someone else.
  const read = await call(api.detail, 'GET', `?userId=${member.id}`);
  expect(read.status).toBe(400);
  expect(read.body.error.code).toBe('validation_failed');
});

it('ACCT-A04 a member reads only their own account and cannot reach another session or their role', async () => {
  session.user = member;
  session.hash = 'hash-member';
  const read = await call(api.detail, 'GET');
  expect(read.status).toBe(200);
  expect(read.body.data.user).toMatchObject({
    id: member.id,
    email: 'member@example.test',
    role: 'member',
  });
  expect(read.body.data.sessions).toEqual([
    expect.objectContaining({ id: memberSession, current: true, userAgent: 'Agent hash-member' }),
  ]);
  // The administrator's other session is a valid id, and still nothing the member can touch.
  const revoke = await call(api.revokeOne, 'DELETE', `/sessions/${holderOther}`, undefined, {
    params: { id: holderOther },
  });
  expect(revoke.status).toBe(404);
  const rows = await db().select().from(sessions).where(eq(sessions.id, holderOther));
  expect(rows[0]?.revokedAt).toBeNull();
  // ACCT-I02: role and active state cannot be named in a patch, so a promotion is a 400 and the
  // row is untouched.
  const promote = await call(api.patch, 'PATCH', '', { revision: 1, role: 'admin' });
  expect(promote.status).toBe(400);
  const activate = await call(api.patch, 'PATCH', '', { revision: 1, isActive: false });
  expect(activate.status).toBe(400);
  expect(await userRow(member.id)).toMatchObject({ role: 'member', isActive: true, revision: 1 });
});

it('ACCT-B06 without a session every endpoint answers 401 in the error envelope', async () => {
  session.user = null;
  const read = await call(api.detail, 'GET');
  expect(read.status).toBe(401);
  expect(read.body).toEqual({
    error: {
      code: 'unauthenticated',
      message: 'unauthenticated',
      details: null,
      requestId: expect.any(String),
    },
  });
  expect(Object.keys(read.body.error).sort()).toEqual(['code', 'details', 'message', 'requestId']);
  for (const [handler, method, path, body] of [
    [api.patch, 'PATCH', '', { revision: 1, name: 'Nobody' }],
    [api.email, 'POST', '/email', { revision: 1, email: 'nobody@example.test', current: PASSWORD }],
    [api.password, 'POST', '/password', { current: PASSWORD, next: 'another long password' }],
    [api.revokeOthers, 'POST', '/sessions/revoke-others', {}],
  ] as const) {
    const response = await call(handler, method, path, body);
    expect(response.status).toBe(401);
  }
  expect(await userRow(holder.id)).toMatchObject({
    name: 'Account Holder',
    email: 'holder@example.test',
  });
});

it('ACCT-B06 a write from another origin or without the request marker is refused before it runs', async () => {
  const foreign = await call(
    api.patch,
    'PATCH',
    '',
    { revision: 1, name: 'Intruder' },
    {
      origin: 'https://untrusted.example.test',
    },
  );
  expect(foreign.status).toBe(403);
  expect(foreign.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'origin' } });
  const plain = await call(
    api.email,
    'POST',
    '/email',
    { revision: 1, email: 'x@example.test', current: PASSWORD },
    {
      requestedWith: null,
    },
  );
  expect(plain.status).toBe(403);
  expect(await userRow(holder.id)).toMatchObject({
    name: 'Account Holder',
    email: 'holder@example.test',
  });
  // A read carries no origin requirement: the browser sends none on navigation.
  const read = await call(api.detail, 'GET', '', undefined, {
    origin: 'https://untrusted.example.test',
  });
  expect(read.status).toBe(200);
});

it('ACCT-B01 ACCT-B02 ACCT-B04 validation failures name the field in dotted paths', async () => {
  const name = await call(api.patch, 'PATCH', '', { revision: 1, name: '   ', locale: 'fr' });
  expect(name.status).toBe(400);
  expect(name.body.error.code).toBe('validation_failed');
  expect(Object.keys(name.body.error.details.fieldErrors).sort()).toEqual(['locale', 'name']);
  const email = await call(api.email, 'POST', '/email', { revision: 1, email: 'not-an-address' });
  expect(email.status).toBe(400);
  expect(Object.keys(email.body.error.details.fieldErrors).sort()).toEqual(['current', 'email']);
  const password = await call(api.password, 'POST', '/password', { current: '', next: 'short' });
  expect(password.status).toBe(400);
  expect(Object.keys(password.body.error.details.fieldErrors).sort()).toEqual(['current', 'next']);
  const broken = await call(api.patch, 'PATCH', '', '{not json');
  expect(broken.status).toBe(400);
  expect(await userRow(holder.id)).toMatchObject({ revision: 1, passwordHash });
});

it('ACCT-B01 renaming returns the account, bumps the revision and a stale revision is a 409', async () => {
  const renamed = await call(api.patch, 'PATCH', '', { revision: 1, name: '  Renamed Holder ' });
  expect(renamed.status).toBe(200);
  expect(renamed.headers.get('X-Request-Id')).toBeTruthy();
  expect(renamed.headers.get('Cache-Control')).toBe('no-store');
  expect(Object.keys(renamed.body)).toEqual(['data']);
  expect(renamed.body.data.user).toMatchObject({
    id: holder.id,
    name: 'Renamed Holder',
    revision: 2,
  });
  expect(renamed.body.data).toHaveProperty('person');
  expect(renamed.body.data).toHaveProperty('preferences');
  expect(renamed.body.data.sessions).toHaveLength(2);
  const stale = await call(api.patch, 'PATCH', '', { revision: 1, name: 'Too Late' });
  expect(stale.status).toBe(409);
  expect(stale.body.error).toMatchObject({ code: 'conflict', details: { expected: 2 } });
  const staleEmail = await call(api.email, 'POST', '/email', {
    revision: 1,
    email: 'late@example.test',
    current: PASSWORD,
  });
  expect(staleEmail.status).toBe(409);
  expect(await userRow(holder.id)).toMatchObject({
    name: 'Renamed Holder',
    email: 'holder@example.test',
  });
});

it('ACCT-B01 the address is lowercased on the way in and a taken address is a field error', async () => {
  const changed = await call(api.email, 'POST', '/email', {
    revision: 1,
    email: 'Holder.New@Example.TEST',
    current: PASSWORD,
  });
  expect(changed.status).toBe(200);
  expect(changed.body.data.user).toMatchObject({ email: 'holder.new@example.test', revision: 2 });
  const taken = await call(api.email, 'POST', '/email', {
    revision: 2,
    email: 'MEMBER@example.test',
    current: PASSWORD,
  });
  expect(taken.status).toBe(400);
  expect(taken.body.error).toMatchObject({
    code: 'validation_failed',
    details: { fieldErrors: { email: ['email_taken'] } },
  });
  expect(await userRow(holder.id)).toMatchObject({ email: 'holder.new@example.test', revision: 2 });
});

it('ACCT-B04 ACCT-I03 preferences are written per reader and "" clears the row so the workspace default shows through', async () => {
  await writeSetting(db(), 'workspace.default_locale', 'ar', holder.id);
  const set = await call(api.patch, 'PATCH', '', { revision: 1, locale: 'en', theme: 'light' });
  expect(set.status).toBe(200);
  expect(set.body.data.preferences).toMatchObject({ locale: 'en', theme: 'light' });
  expect([...set.body.data.preferences.explicit].sort()).toEqual(['locale', 'theme']);
  // A preference does not touch the user row, so the revision the client holds stays valid.
  expect(set.body.data.user.revision).toBe(1);
  const rows = await db().select().from(settings).where(eq(settings.userId, holder.id));
  expect(rows.map((row) => [row.key, row.scope, row.value]).sort()).toEqual([
    ['user.locale', 'user', 'en'],
    ['user.theme', 'user', 'light'],
  ]);
  // The pages read the language from a cookie, so the patch sets it to what the reader now sees.
  expect(session.localeCookie).toBe('en');
  const cleared = await call(api.patch, 'PATCH', '', { revision: 1, locale: '' });
  expect(cleared.status).toBe(200);
  expect(session.localeCookie).toBe('ar');
  expect(cleared.body.data.preferences.explicit).toEqual(['theme']);
  const left = await db().select().from(settings).where(eq(settings.userId, holder.id));
  expect(left.map((row) => row.key)).toEqual(['user.theme']);
  // The member's own preferences are a different set of rows entirely.
  session.user = member;
  session.hash = 'hash-member';
  const theirs = await call(api.detail, 'GET');
  expect(theirs.body.data.preferences.explicit).toEqual([]);
});

it('ACCT-B04 the saved theme is the one pages are drawn in, and dark before sign-in', async () => {
  expect(await readerTheme()).toBe('dark');
  await call(api.patch, 'PATCH', '', { revision: 1, theme: 'light' });
  expect(await readerTheme()).toBe('light');
  session.user = null;
  expect(await readerTheme()).toBe('dark');
});

it('ACCT-B01 ACCT-B06 a retried write replays its answer and a different body under the same key is a 409', async () => {
  const key = crypto.randomUUID();
  const first = await call(api.patch, 'PATCH', '', { revision: 1, name: 'Once' }, { key });
  expect(first.status).toBe(200);
  const replay = await call(api.patch, 'PATCH', '', { revision: 1, name: 'Once' }, { key });
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  // Had the retry run again it would have met the bumped revision and answered 409.
  expect(await userRow(holder.id)).toMatchObject({ name: 'Once', revision: 2 });
  const reused = await call(api.patch, 'PATCH', '', { revision: 2, name: 'Twice' }, { key });
  expect(reused.status).toBe(409);
  expect(reused.body.error).toMatchObject({ code: 'conflict', details: { reason: 'duplicate' } });
  expect(await userRow(holder.id)).toMatchObject({ name: 'Once', revision: 2 });
});

it('ACCT-B02 a wrong current password is reported on that field and changes nothing', async () => {
  const wrong = await call(api.password, 'POST', '/password', {
    current: 'not the password',
    next: 'a brand new password',
  });
  expect(wrong.status).toBe(400);
  expect(wrong.body.error).toMatchObject({
    code: 'validation_failed',
    details: { fieldErrors: { current: ['password_incorrect'] } },
  });
  expect(await userRow(holder.id)).toMatchObject({
    passwordHash,
    passwordChangedAt: null,
    revision: 1,
  });
  expect((await live(holder.id)).every((row) => row.revokedAt === null)).toBe(true);
});

it('ACCT-B02 ACCT-A02 the right current password changes it, keeps this session and signs out every other', async () => {
  const changed = await call(api.password, 'POST', '/password', {
    current: PASSWORD,
    next: 'a brand new password',
  });
  expect(changed.status).toBe(200);
  expect(changed.body).toEqual({ data: { revoked: 1 } });
  const row = await userRow(holder.id);
  expect(row?.passwordHash).not.toBe(passwordHash);
  expect(row?.passwordChangedAt).toBeInstanceOf(Date);
  const mine = await live(holder.id);
  expect(mine.find((s) => s.tokenHash === 'hash-holder-current')?.revokedAt).toBeNull();
  expect(mine.find((s) => s.tokenHash === 'hash-holder-other')?.revokedAt).toBeInstanceOf(Date);
  // Someone else's devices are not "other sessions" of this account.
  expect((await live(member.id))[0]?.revokedAt).toBeNull();
  const after = await call(api.detail, 'GET');
  expect(after.body.data.user.passwordChangedAt).toEqual(row?.passwordChangedAt?.toISOString());
  expect(after.body.data.sessions).toEqual([expect.objectContaining({ current: true })]);
});

it('ACCT-B03 the list marks this device, one session is revoked by id and a second attempt is a 404', async () => {
  const read = await call(api.detail, 'GET');
  const listed = read.body.data.sessions as {
    id: string;
    current: boolean;
    ip: string;
    userAgent: string;
  }[];
  expect(listed).toHaveLength(2);
  expect(listed.filter((s) => s.current).map((s) => s.userAgent)).toEqual([
    'Agent hash-holder-current',
  ]);
  expect(listed.find((s) => s.id === holderOther)).toMatchObject({
    current: false,
    ip: '203.0.113.7',
    userAgent: 'Agent hash-holder-other',
  });
  const revoked = await call(api.revokeOne, 'DELETE', `/sessions/${holderOther}`, undefined, {
    params: { id: holderOther },
  });
  expect(revoked.status).toBe(200);
  expect(revoked.body).toEqual({ data: { id: holderOther } });
  const again = await call(api.revokeOne, 'DELETE', `/sessions/${holderOther}`, undefined, {
    params: { id: holderOther },
  });
  expect(again.status).toBe(404);
  expect(again.body.error).toMatchObject({ code: 'not_found', message: 'not_found' });
  const unknown = await call(api.revokeOne, 'DELETE', `/sessions/${id()}`, undefined, {
    params: { id: id() },
  });
  expect(unknown.status).toBe(404);
  const malformed = await call(api.revokeOne, 'DELETE', '/sessions/not-a-uuid', undefined, {
    params: { id: 'not-a-uuid' },
  });
  expect(malformed.status).toBe(400);
});

it('ACCT-B03 "sign out everywhere else" revokes every other session, replays under its key, and leaves this one', async () => {
  await session_(holder.id, 'hash-holder-third');
  const key = crypto.randomUUID();
  const done = await call(api.revokeOthers, 'POST', '/sessions/revoke-others', {}, { key });
  expect(done.status).toBe(200);
  expect(done.body).toEqual({ data: { revoked: 2 } });
  const replay = await call(api.revokeOthers, 'POST', '/sessions/revoke-others', {}, { key });
  expect(replay.body).toEqual({ data: { revoked: 2 } });
  // A fresh call finds nothing left to revoke, which is how the replay above is told apart.
  const fresh = await call(api.revokeOthers, 'POST', '/sessions/revoke-others', {});
  expect(fresh.body).toEqual({ data: { revoked: 0 } });
  const read = await call(api.detail, 'GET');
  expect(read.body.data.sessions).toEqual([
    expect.objectContaining({ current: true, userAgent: 'Agent hash-holder-current' }),
  ]);
  expect((await live(member.id))[0]?.revokedAt).toBeNull();
});
