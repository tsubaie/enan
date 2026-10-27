import 'server-only';
import { passkey } from '@better-auth/passkey';
import { APIError, getSessionFromCtx } from 'better-auth/api';
import { z } from 'zod';
import { type Environment } from '@/core/config/env';
import { db, withTransaction, type Database } from '@/core/db/client';
import { userById, userPasskeys } from '@/core/db/auth-repo';
import { writeAudit } from '@/core/db/audit-repo';
import { checkCurrentPassword } from './login';
import { signInMethods } from './methods';
// ADR 0064: passkeys through Better Auth's plugin. Signing in with one is guarded like any other
// method (better-auth.ts); adding and removing one are Enan's own rules, applied here:
// - ADMIN-B76 a passkey is added only while the method is on, by a signed-in member who proves it is
//   still them: their current password while passwords are on, otherwise a session under ten
//   minutes old;
// - ADMIN-B76 the last passkey cannot be removed while passkeys are the only way in;
// - ACCT-B10 every passkey added or removed reaches the audit log.
const freshMinutes = 10;
type Ctx = Parameters<typeof getSessionFromCtx>[0];
const fail = (status: 'BAD_REQUEST' | 'FORBIDDEN' | 'CONFLICT' | 'UNAUTHORIZED', code: string) =>
  new APIError(status, { code, message: code });
export function passkeys(config: Environment) {
  return passkey({
    rpID: new URL(config.APP_URL).hostname,
    rpName: 'Enan',
    origin: config.APP_URL.replace(/\/$/u, ''),
    // Enan's own step-up below replaces the plugin's one-day "fresh session" rule.
    registration: {
      requireSession: false,
      resolveUser: async ({ ctx }) => {
        const session = await getSessionFromCtx(ctx);
        if (!session?.user) throw fail('UNAUTHORIZED', 'SESSION_REQUIRED');
        return {
          id: session.user.id,
          name: session.user.email,
          displayName: session.user.name || session.user.email,
        };
      },
    },
  });
}
async function signedIn(ctx: Ctx) {
  const session = await getSessionFromCtx(ctx);
  if (!session) throw fail('UNAUTHORIZED', 'SESSION_REQUIRED');
  return session;
}
// The password is checked against the email bucket of ADMIN-B20, and a mismatch is recorded before
// the refusal, so a stolen session cannot guess its way to a passkey either.
async function passwordMatches(userId: string, password: string) {
  const user = await userById(db(), userId);
  if (!user || !password) return false;
  return withTransaction(db(), (database) => checkCurrentPassword(database, user, password));
}
async function enabledFor(ctx: Ctx) {
  const session = await signedIn(ctx);
  const { enabled } = await signInMethods(db());
  if (!enabled.includes('passkey')) throw fail('FORBIDDEN', 'METHOD_DISABLED');
  return { session, enabled };
}
// Checked where the passkey is stored: the plugin's client sends extra headers with the verifying
// POST only, not with the GET that asks for the options.
async function stepUp(ctx: Ctx) {
  const { session, enabled } = await enabledFor(ctx);
  // Registering finishes in the session that began it, and never opens a new one.
  if (ctx.body?.createSession) throw fail('BAD_REQUEST', 'SESSION_REQUIRED');
  if (enabled.includes('password')) {
    const password = ctx.headers?.get('x-current-password') ?? '';
    if (!(await passwordMatches(session.user.id, password)))
      throw fail('BAD_REQUEST', 'INVALID_PASSWORD');
    return;
  }
  if (Date.now() - new Date(session.session.createdAt).getTime() >= freshMinutes * 60000)
    throw fail('FORBIDDEN', 'SESSION_NOT_FRESH');
}
async function lastMethod(ctx: Ctx) {
  const session = await signedIn(ctx);
  const { enabled } = await signInMethods(db());
  if (enabled.length > 1 || enabled[0] !== 'passkey') return;
  if ((await userPasskeys(db(), session.user.id)).length <= 1)
    throw fail('CONFLICT', 'LAST_SIGN_IN_METHOD');
}
export async function passkeyBefore(ctx: Ctx) {
  if (ctx.path === '/passkey/generate-register-options') await enabledFor(ctx);
  if (ctx.path === '/passkey/verify-registration') await stepUp(ctx);
  if (ctx.path === '/passkey/delete-passkey') await lastMethod(ctx);
}
const Added = z.object({ userId: z.string(), name: z.string().nullish() });
export async function passkeyAfter(ctx: Ctx, returned: unknown, database: Database) {
  if (returned instanceof APIError) return;
  if (ctx.path === '/passkey/verify-registration') {
    const added = Added.safeParse(returned);
    if (added.success)
      await writeAudit(database, added.data.userId, 'account.passkey.add', 'user', added.data.userId, {
        name: added.data.name ?? null,
      });
  }
  const actor = ctx.context.session?.user.id;
  if (ctx.path === '/passkey/delete-passkey' && actor)
    await writeAudit(database, actor, 'account.passkey.remove', 'user', actor, {});
}
