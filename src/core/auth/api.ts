import 'server-only';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { defineHandler, authenticated } from '@/core/http/handler';
import { Login, User, Recovery } from './validation';
import { login, recover } from './login';
import { setLocaleCookie, setSessionCookie } from './session';
import { getSetting, hasSetting } from '@/core/db/settings-repo';
import { revokeSession } from '@/core/db/auth-repo';
import { digest } from './password';
import { defaults } from '@/core/config/defaults';
import { clientIp } from '@/core/http/client-ip';
import { after } from 'next/server';
import { db, type Database } from '@/core/db/client';
import { SignInCode } from '@/core/config/sign-in-schema';
import { logger } from '@/core/config/logger';
import { mailUser } from '@/core/mail/send';
import { codeMinutes, requestCode, signInWithCode } from './code';
export const loginApi = defineHandler({
  guard: 'public',
  input: Login,
  response: z.object({ data: User }),
  handler: async (input, context, _params, request) =>
    signedIn(context.db, await login(context.db, input, clientIp(request))),
});
async function signedIn(database: Database, result: { user: User; token: string }) {
  await setSessionCookie(result.token);
  // ACCT-B04: a language the reader chose follows them to this browser, over whatever cookie it
  // kept from before. Without a choice, the cookie (perhaps set on the sign-in page) stands.
  if (await hasSetting(database, 'user.locale', result.user.id))
    await setLocaleCookie(await getSetting(database, 'user.locale', result.user.id));
  return { data: result.user };
}
// ADMIN-B63: the reply is the same whether or not the email has an account. The code is mailed
// after the response, so how long the mail server takes cannot tell the two apart either; a mail
// that fails is logged, and the reader asks again.
export const codeRequestApi = defineHandler({
  guard: 'public',
  input: z.strictObject({ email: Login.shape.email }),
  response: z.object({ data: z.null() }),
  handler: async (input, context, _params, request) => {
    const issued = await requestCode(context.db, input.email, clientIp(request));
    if (issued)
      after(() =>
        mailUser(db(), issued.user, (copy, workspace) => ({
          subject: copy.codeSubject.replaceAll('{workspace}', workspace),
          lines: [
            copy.codeBody.replaceAll('{code}', issued.code),
            copy.codeExpiry.replaceAll('{minutes}', String(codeMinutes)),
          ],
        })).catch((error) => logger.warn({ err: error }, 'The sign-in code was not mailed')),
      );
    return { data: null };
  },
});
export const codeSignInApi = defineHandler({
  guard: 'public',
  input: z.strictObject({ email: Login.shape.email, code: SignInCode }),
  response: z.object({ data: User }),
  handler: async (input, context, _params, request) =>
    signedIn(context.db, await signInWithCode(context.db, input, clientIp(request))),
});
export const recoveryApi = defineHandler({
  guard: 'public',
  input: Recovery,
  response: z.object({ data: z.null() }),
  handler: async (input, context, _params, request) => {
    await recover(context.db, input, clientIp(request));
    return { data: null };
  },
});
export const logoutApi = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: z.object({ data: z.null() }),
  handler: async (_, ctx) => {
    const jar = await cookies();
    const raw = jar.get(defaults.cookieName)?.value;
    if (raw) await revokeSession(digest(raw), ctx.db);
    jar.delete(defaults.cookieName);
    return { data: null };
  },
});
export const meApi = defineHandler({
  guard: 'session',
  input: z.strictObject({}),
  response: z.object({ data: User }),
  handler: async (_, ctx) => ({ data: authenticated(ctx).user }),
});
