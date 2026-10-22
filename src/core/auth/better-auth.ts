import 'server-only';
import { after } from 'next/server';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP } from 'better-auth/plugins';
import { z } from 'zod';
import { env, secureCookies } from '@/core/config/env';
import { logger } from '@/core/config/logger';
import { db } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { recordLogin, userByEmail, userById } from '@/core/db/auth-repo';
import { getSetting, hasSetting } from '@/core/db/settings-repo';
import { codeRequests, recordCodeRequest } from '@/core/db/sign-in-code-repo';
import { users } from '@/core/db/system-schema';
import { authAccounts, authSessions, authVerifications } from '@/core/db/auth-schema';
import { clientIp } from '@/core/http/client-ip';
import { AppError } from '@/core/http/errors';
import { mailUser } from '@/core/mail/send';
import { googleClient } from './google-settings';
import { throttle } from './login';
import { requireMethod } from './methods';
import { hashPassword, verifyPassword } from './password';
/**
 * ADR 0055: sign-in and sessions are Better Auth's. Enan's own rules ride on its hooks:
 * - ADMIN-B64 a method the workspace has not turned on is refused on the API, not only hidden;
 * - ADMIN-B20 the email and the client address (resolved by `clientIp`, ADR 0013) are throttled as
 *   independent buckets for passwords and codes, and every attempt is recorded;
 * - ADMIN-B63 code requests are throttled per email and per address, known or not;
 * - a deactivated or deleted account gets no session, whatever the method (ADMIN-B03);
 * - every state-changing call carries `X-Requested-With: Enan` (ADR 0005, ADR 0048).
 */
export const sessionDays = 30;
export const codeMinutes = 10;
const sendsPerEmail = 3;
const sendsPerAddress = 10;
const Email = z.object({ email: z.string().transform((value) => value.toLowerCase()) });
const refused = (code: string) => new APIError('FORBIDDEN', { code, message: code });
// Enan's errors become Better Auth's, so its client reads one shape.
async function ours(work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    if (error.code === 'rate_limited')
      throw new APIError('TOO_MANY_REQUESTS', { code: 'RATE_LIMITED', message: 'rate_limited' });
    throw refused(error.code === 'forbidden' ? 'SIGN_IN_METHOD_DISABLED' : error.code);
  }
}
// The hasher admits two at a time (ADMIN-B21); a third is told to retry rather than shown a 500.
async function hashing<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError && error.code === 'rate_limited')
      throw new APIError('TOO_MANY_REQUESTS', { code: 'RATE_LIMITED', message: 'rate_limited' });
    throw error;
  }
}
type Guard = { method: 'password' | 'code' | 'google'; throttle?: 'login' | 'send' };
const guards: Record<string, Guard> = {
  '/sign-in/email': { method: 'password', throttle: 'login' },
  '/sign-in/email-otp': { method: 'code', throttle: 'login' },
  '/email-otp/send-verification-otp': { method: 'code', throttle: 'send' },
  '/sign-in/social': { method: 'google' },
  '/callback/:id': { method: 'google' },
};
async function sendThrottle(email: string, ip: string | null) {
  const sent = await codeRequests(db(), email, ip);
  if (sent.byEmail >= sendsPerEmail || sent.byAddress >= sendsPerAddress)
    throw new AppError('rate_limited', { scope: 'sign_in_code', retryAfterSeconds: 900 });
  await recordCodeRequest(db(), email, ip);
}
const before = createAuthMiddleware(async (ctx) => {
  if (ctx.request?.method === 'POST' && ctx.request.headers.get('x-requested-with') !== 'Enan')
    throw refused('ORIGIN');
  const guard = guards[ctx.path];
  if (!guard) return;
  // Checked first, so a request for anything but a sign-in code spends none of the send quota.
  if (ctx.path === '/email-otp/send-verification-otp' && ctx.body?.type !== 'sign-in')
    throw new APIError('BAD_REQUEST', { code: 'SIGN_IN_ONLY', message: 'sign_in_only' });
  const email = Email.safeParse(ctx.body).data?.email ?? null;
  const ip = ctx.request ? clientIp(ctx.request) : null;
  await ours(async () => {
    await requireMethod(db(), guard.method);
    if (guard.throttle === 'login' && email) await throttle(db(), email, ip);
    if (guard.throttle === 'send' && email) await sendThrottle(email, ip);
  });
});
// ACCT-B04: a language the reader chose follows them to the browser they sign in on, over whatever
// cookie it kept. Without a choice, the cookie (perhaps set on the sign-in page) stands.
async function rememberLocale(userId: string, set: (name: string, value: string) => void) {
  if (await hasSetting(db(), 'user.locale', userId))
    set('eos_locale', await getSetting(db(), 'user.locale', userId));
}
// ADMIN-B20: every password or code attempt is recorded, so the buckets above count it.
const afterwards = createAuthMiddleware(async (ctx) => {
  const signedIn = ctx.context.newSession;
  if (signedIn)
    await rememberLocale(signedIn.user.id, (name, value) =>
      ctx.setCookie(name, value, { path: '/', sameSite: 'lax', maxAge: 31536000 }),
    );
  if (guards[ctx.path]?.throttle !== 'login') return;
  const email = Email.safeParse(ctx.body).data?.email;
  if (!email) return;
  const ip = ctx.request ? clientIp(ctx.request) : null;
  await recordLogin(db(), email, ip, Boolean(ctx.context.newSession));
});
// The account behind a session must still be one: deactivated and deleted accounts are refused the
// way a wrong password is, so the answer says nothing about which it was.
async function activeOnly(session: { userId: string }) {
  const user = await userById(db(), session.userId);
  if (!user || !user.isActive || user.deletedAt)
    throw new APIError('UNAUTHORIZED', {
      code: 'INVALID_EMAIL_OR_PASSWORD',
      message: 'Invalid email or password',
    });
}
async function mailCode(email: string, otp: string) {
  // Better Auth asks whether the address exists; a deactivated or deleted account gets no code.
  const user = await userByEmail(db(), email);
  if (!user || !user.isActive || user.deletedAt) return;
  await mailUser(db(), user, (copy, workspace) => ({
    subject: copy.codeSubject.replaceAll('{workspace}', workspace),
    lines: [
      copy.codeBody.replaceAll('{code}', otp),
      copy.codeExpiry.replaceAll('{minutes}', String(codeMinutes)),
    ],
  }));
}
function ipConfig() {
  const proxies = env()
    .TRUSTED_PROXY_CIDRS.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  // ADR 0013: without a trusted proxy no forwarded address is believed, so none is recorded.
  return proxies.length > 0
    ? { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: proxies }
    : { disableIpTracking: true };
}
// Endpoints Enan does not use: signing up, changing or resetting a password or email by mail, and
// handing tokens or session lists to the browser. The account and admin pages have their own.
const unused = [
  '/verify-password',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
  '/delete-user/callback',
  '/email-otp/check-verification-otp',
  '/sign-up/email',
  '/change-password',
  '/change-email',
  '/update-user',
  '/delete-user',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/update-session',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/send-verification-email',
  '/verify-email',
  '/link-social',
  '/unlink-account',
  '/email-otp/verify-email',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/forget-password/email-otp',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
];

const userFields = {
  additionalFields: {
    role: { type: 'string', input: false },
    isActive: { type: 'boolean', input: false },
    revision: { type: 'number', input: false },
    deletedAt: { type: 'date', required: false, input: false },
    // The previous release's copy of the password (ADR 0050); never taken in, never sent out.
    passwordHash: { type: 'string', input: false, returned: false },
  },
} satisfies BetterAuthOptions['user'];
// Members are added by an administrator: nobody signs themselves up, by any method. Enan's
// argon2id (m=64 MiB, t=3, p=4) stays, so hashes from before Better Auth verify unchanged.
const passwords: BetterAuthOptions['emailAndPassword'] = {
  enabled: true,
  disableSignUp: true,
  minPasswordLength: 12,
  maxPasswordLength: 256,
  password: {
    hash: (password) => hashing(() => hashPassword(password)),
    verify: ({ hash, password }) => hashing(() => verifyPassword(hash, password)),
  },
};
const codes = () =>
  emailOTP({
    otpLength: 6,
    expiresIn: codeMinutes * 60,
    allowedAttempts: 5,
    disableSignUp: true,
    storeOTP: 'hashed',
    sendVerificationOTP: ({ email, otp }) => mailCode(email, otp),
  });
async function googleProvider(): Promise<BetterAuthOptions['socialProviders']> {
  const google = await googleClient(db()).catch((error: Error) => {
    logger.warn({ err: error }, 'The saved Google client cannot be read; Google sign-in is off');
    return null;
  });
  if (!google) return {};
  return {
    google: {
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      disableSignUp: true,
      prompt: 'select_account',
    },
  };
}
async function build() {
  const config = env();
  return betterAuth({
    appName: 'Enan',
    baseURL: config.APP_URL,
    basePath: '/api/auth',
    secret: config.SESSION_SECRET,
    database: drizzleAdapter(db(), {
      provider: 'sqlite',
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    user: userFields,
    session: { expiresIn: sessionDays * 86400, updateAge: 86400 },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: passwords,
    socialProviders: await googleProvider(),
    plugins: [codes(), nextCookies()],
    // ADMIN-B20 replaces Better Auth's own limiter, which keys by address alone; what it would still
    // guard and Enan does not use is switched off instead.
    rateLimit: { enabled: false },
    disabledPaths: unused,
    hooks: { before, after: afterwards },
    databaseHooks: { session: { create: { before: activeOnly } } },
    onAPIError: { errorURL: '/login' },
    advanced: {
      cookiePrefix: 'enan',
      useSecureCookies: secureCookies(config),
      ipAddress: ipConfig(),
      database: { generateId: () => id() },
      // The reply does not wait for the mail server, so its timing cannot tell who has an account.
      backgroundTasks: { handler: (work) => after(() => work) },
    },
    telemetry: { enabled: false },
  });
}
let instance: ReturnType<typeof build> | undefined;
export function auth() {
  instance ??= build();
  return instance;
}
// A saved or removed Google client takes effect on the next request.
export function resetAuth() {
  instance = undefined;
}
