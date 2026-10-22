import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, withTransaction } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { insertUser, lockWorkspace } from '@/core/db/auth-repo';
import { readGoogleSettings } from '@/core/db/google-settings-repo';
import { auditEntries } from '@/core/db/admin-repo';
import { writeSetting } from '@/core/db/settings-repo';
import { sessions, users } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { env } from '@/core/config/env';
const jar = vi.hoisted(() => new Map<string, { value: string; options: object }>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: object = {}) => jar.set(name, { value, options }),
    delete: (cookie: string | { name: string }) =>
      jar.delete(typeof cookie === 'string' ? cookie : cookie.name),
  }),
}));
const { googleCallback, googleStart } = await import('../google');
const { googleClient, googleStatus, saveGoogle, removeGoogle } = await import('../google-settings');
const clientId = '1234-abc.apps.googleusercontent.com';
const clientSecret = 'fixture-google-secret';
const token = vi.fn<typeof fetch>();
let member = '';
beforeAll(() => migrateDatabase());
beforeEach(async () => {
  jar.clear();
  token.mockReset();
  vi.stubGlobal('fetch', token);
  await clearDatabase();
  member = await withTransaction(db(), async (database) => {
    await lockWorkspace(database);
    const user = await insertUser(database, {
      id: id(),
      name: 'Member',
      email: 'member@example.test',
      passwordHash: 'unused',
      role: 'member',
    });
    await saveGoogle(database, user.id, { clientId, clientSecret });
    return user.id;
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  return closeDatabase();
});
const idToken = (claims: object) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
async function start() {
  const response = await googleStart();
  const location = new URL(response.headers.get('location') ?? '');
  return { response, location, state: location.searchParams.get('state') ?? '' };
}
async function finish(claims: Record<string, string | number | boolean> = {}, state?: string) {
  const begun = await start();
  const nonce = begun.location.searchParams.get('nonce');
  token.mockResolvedValue(
    Response.json({
      id_token: idToken({
        iss: 'https://accounts.google.com',
        aud: clientId,
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce,
        sub: 'google-subject-1',
        email: 'Member@example.test',
        email_verified: true,
        ...claims,
      }),
    }),
  );
  const url = new URL('/api/v1/auth/google/callback', env().APP_URL);
  url.search = new URLSearchParams({ code: 'auth-code', state: state ?? begun.state }).toString();
  const response = await googleCallback(new Request(url));
  return { begun, response, location: response.headers.get('location') ?? '' };
}
const memberRow = async () => (await db().select().from(users).where(eq(users.id, member)))[0];

it('ADMIN-B65 the client secret is sealed, never returned, and kept only for the same client', async () => {
  const stored = await readGoogleSettings(db());
  expect(stored?.encryptedSecret).toMatch(/^v1\./u);
  expect(JSON.stringify(stored)).not.toContain(clientSecret);
  expect(JSON.stringify(await auditEntries(db()))).not.toContain(clientSecret);
  const status = await googleStatus(db());
  expect(status).toEqual({
    source: 'saved',
    clientId,
    hasSecret: true,
    redirectUri: `${env().APP_URL}/api/v1/auth/google/callback`,
  });
  expect(JSON.stringify(status)).not.toContain(clientSecret);
  await saveGoogle(db(), member, { clientId, clientSecret: '' });
  expect((await googleClient(db()))?.clientSecret).toBe(clientSecret);
  await expect(
    saveGoogle(db(), member, { clientId: 'other.apps.googleusercontent.com' }),
  ).rejects.toMatchObject({ code: 'validation_failed' });
  await expect(
    saveGoogle(db(), member, { clientId: 'not-a-client-id', clientSecret }),
  ).rejects.toThrow();
  await removeGoogle(db(), member);
  expect((await googleStatus(db())).source).toBe('none');
});
it('ADMIN-B65 sign-in starts at Google with PKCE, a state and a nonce held in a scoped cookie', async () => {
  const { response, location, state } = await start();
  expect(response.status).toBe(303);
  expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(location.searchParams.get('client_id')).toBe(clientId);
  expect(location.searchParams.get('redirect_uri')).toBe(
    `${env().APP_URL}/api/v1/auth/google/callback`,
  );
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(location.searchParams.get('scope')).toBe('openid email');
  const cookie = jar.get('eos_google');
  const [saved, verifier] = (cookie?.value ?? '').split('.');
  expect(saved).toBe(state);
  expect(location.searchParams.get('code_challenge')).toBe(
    createHash('sha256')
      .update(verifier ?? '')
      .digest('base64url'),
  );
  expect(cookie?.options).toMatchObject({
    httpOnly: true,
    path: '/api/v1/auth/google',
    maxAge: 600,
  });
});
it('ADMIN-B65 a member added by an administrator signs in, and the Google account becomes theirs', async () => {
  const { location } = await finish();
  expect(location).toBe(`${env().APP_URL}/home`);
  expect(jar.get('eos_session')?.value).toMatch(/^[0-9a-f]{64}$/u);
  expect(jar.has('eos_google')).toBe(false);
  expect((await memberRow())?.googleSubject).toBe('google-subject-1');
  expect(await db().select().from(sessions)).toHaveLength(1);
  const sent = new URLSearchParams(String(token.mock.calls[0]?.[1]?.body));
  expect(sent.get('client_secret')).toBe(clientSecret);
  expect(sent.get('code_verifier')).toBeTruthy();
  // Another Google account with the same address cannot take the account over afterwards.
  jar.clear();
  expect((await finish({ sub: 'google-subject-2' })).location).toContain('error=google_unknown');
  expect(jar.has('eos_session')).toBe(false);
});
it('ADMIN-B65 an unknown or deactivated account is refused and nothing is created', async () => {
  expect((await finish({ email: 'stranger@example.test' })).location).toContain(
    'error=google_unknown',
  );
  expect(await db().select().from(users)).toHaveLength(1);
  await db().update(users).set({ isActive: false }).where(eq(users.id, member));
  expect((await finish()).location).toContain('error=google_unknown');
  expect(await db().select().from(sessions)).toHaveLength(0);
});
it('ADMIN-B65 a forged state, an unverified email, another audience, a stale token or a wrong nonce fail', async () => {
  const forged = await finish({}, 'forged-state');
  expect(forged.location).toContain('error=google_failed');
  expect(token).not.toHaveBeenCalled();
  for (const claims of [
    { email_verified: false },
    { aud: 'other.apps.googleusercontent.com' },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { nonce: 'replayed' },
    { iss: 'https://evil.example.test' },
  ])
    expect((await finish(claims)).location).toContain('error=google_failed');
  expect(await db().select().from(sessions)).toHaveLength(0);
});
it('ADMIN-B65 with the method switched off or no client, sign-in does not reach Google', async () => {
  await withTransaction(db(), (database) =>
    writeSetting(database, 'auth.sign_in_methods', ['password'], member),
  );
  expect((await start()).location.pathname).toBe('/login');
  await withTransaction(db(), (database) =>
    writeSetting(database, 'auth.sign_in_methods', ['password', 'google'], member),
  );
  await removeGoogle(db(), member);
  expect((await start()).location.search).toBe('?error=google_failed');
});
