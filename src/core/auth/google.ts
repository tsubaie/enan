import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { env, secureCookies } from '@/core/config/env';
import { logger } from '@/core/config/logger';
import { db, withTransaction, type Database } from '@/core/db/client';
import { initialized, recordLogin, userByEmail } from '@/core/db/auth-repo';
import { linkGoogleSubject } from '@/core/db/google-settings-repo';
import { getSetting, hasSetting } from '@/core/db/settings-repo';
import { clientIp } from '@/core/http/client-ip';
import { AppError } from '@/core/http/errors';
import { routes } from '@/core/routes';
import { googleClient, googleRedirectUri } from './google-settings';
import { requireMethod } from './methods';
import { newSession, setLocaleCookie, setSessionCookie } from './session';
// ADMIN-B65: Google sign-in is the OAuth authorization-code flow with PKCE. The state, the PKCE
// verifier and the OpenID nonce live in a short-lived cookie scoped to these two routes, so a
// callback is only accepted in the browser that started it.
const flowCookie = 'eos_google';
const flowPath = '/api/v1/auth/google';
const authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const issuers = ['https://accounts.google.com', 'accounts.google.com'];
const random = () => randomBytes(32).toString('base64url');
const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
// Back to the app at its public address, never at whatever host the request reached it by.
const back = (error?: string) =>
  Response.redirect(
    new URL(error ? `${routes.login()}?error=${error}` : routes.home(), env().APP_URL),
    303,
  );
export async function googleStart() {
  try {
    await requireMethod(db(), 'google');
    const client = await googleClient(db());
    if (!client) return back('google_failed');
    const flow = { state: random(), verifier: random(), nonce: random() };
    (await cookies()).set(flowCookie, [flow.state, flow.verifier, flow.nonce].join('.'), {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(),
      path: flowPath,
      maxAge: 600,
    });
    const target = new URL(authorizeUrl);
    target.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: 'openid email',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: challenge(flow.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return Response.redirect(target, 303);
  } catch (error) {
    logger.warn({ err: error }, 'Google sign-in could not start');
    return back('google_failed');
  }
}
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function takeFlow(state: string | null) {
  const jar = await cookies();
  const [saved, verifier, nonce] = (jar.get(flowCookie)?.value ?? '').split('.');
  jar.delete({ name: flowCookie, path: flowPath });
  if (!state || !saved || !verifier || !nonce || !same(state, saved)) return null;
  return { verifier, nonce };
}
// The ID token comes straight from Google's token endpoint over TLS, which OpenID Connect Core
// (3.1.3.7) accepts in place of checking its signature; its claims are still checked one by one.
const Claims = z.object({
  iss: z.enum(issuers),
  aud: z.string(),
  exp: z.number(),
  nonce: z.string(),
  sub: z.string().min(1).max(255),
  email: z.email(),
  email_verified: z.literal(true),
});
export type GoogleIdentity = { subject: string; email: string };
async function exchange(code: string, verifier: string, nonce: string): Promise<GoogleIdentity> {
  const client = await googleClient(db());
  if (!client) throw new AppError('forbidden', { reason: 'google_credentials' });
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: googleRedirectUri(),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new AppError('forbidden', { reason: 'google_token', status: response.status });
  const token = z.object({ id_token: z.string() }).parse(await response.json()).id_token;
  const payload = token.split('.')[1] ?? '';
  const claims = Claims.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  if (
    !same(claims.aud, client.clientId) ||
    claims.exp * 1000 <= Date.now() ||
    !same(claims.nonce, nonce)
  )
    throw new AppError('forbidden', { reason: 'google_claims' });
  return { subject: claims.sub, email: claims.email.toLowerCase() };
}
/**
 * ADMIN-B65: Google signs in only an account an administrator already made, matched on Google's
 * verified email; it never creates one. The first Google account to sign in is tied to the user,
 * and after that only that account may, so an address reissued at Google does not inherit access.
 */
export async function googleSignIn(handle: Database, identity: GoogleIdentity, ip: string | null) {
  return withTransaction(handle, async (database) => {
    if (!(await initialized(database))) throw new AppError('forbidden');
    await requireMethod(database, 'google');
    const user = await userByEmail(database, identity.email);
    const usable = user && user.isActive && !user.deletedAt;
    const owned = user?.googleSubject ? same(user.googleSubject, identity.subject) : true;
    if (!user || !usable || !owned) return null;
    if (!user.googleSubject) await linkGoogleSubject(database, user.id, identity.subject);
    await recordLogin(database, identity.email, ip, true);
    return { userId: user.id, token: await newSession(database, user.id) };
  });
}
export async function googleCallback(request: Request) {
  const query = new URL(request.url).searchParams;
  const flow = await takeFlow(query.get('state'));
  const code = query.get('code');
  if (!flow || !code) return back('google_failed');
  try {
    const identity = await exchange(code, flow.verifier, flow.nonce);
    const result = await googleSignIn(db(), identity, clientIp(request));
    if (!result) return back('google_unknown');
    await setSessionCookie(result.token);
    if (await hasSetting(db(), 'user.locale', result.userId))
      await setLocaleCookie(await getSetting(db(), 'user.locale', result.userId));
    return back();
  } catch (error) {
    logger.warn({ err: error }, 'Google sign-in failed');
    return back('google_failed');
  }
}
