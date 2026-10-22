import 'server-only';
import { cookies, headers } from 'next/headers';
import { Locale } from '@/core/config/defaults';
import { type Database } from '@/core/db/client';
import { auth } from './better-auth';
import { User } from './validation';
export async function setLocaleCookie(locale: string) {
  (await cookies()).set('eos_locale', Locale.parse(locale), {
    path: '/',
    sameSite: 'lax',
    maxAge: 31536000,
  });
}
/**
 * ADR 0055: the session is Better Auth's. ACCT-B09 API requests pass `slide`, so an active reader's
 * session is extended (at most daily) and its cookie re-issued; page renders read it without
 * changing it, because a Server Component cannot set cookies. A session of an account that has
 * since been deactivated or deleted counts for nothing.
 */
async function session(slide: boolean) {
  const found = await (await auth()).api.getSession({
    headers: await headers(),
    query: { disableRefresh: !slide },
  });
  if (!found || !found.user.isActive || found.user.deletedAt) return null;
  return { id: found.session.id, user: User.parse(found.user) };
}
export async function currentUser(options: { slide?: boolean } = {}) {
  return (await session(options.slide ?? false))?.user ?? null;
}
// ACCT-B02/B03: which session is making this request, so the account page marks "this device" and
// a password change keeps the tab it was made in while ending the rest.
export async function currentSessionId() {
  return (await session(false))?.id ?? null;
}
export type Context = { user: User; db: Database; requestId: string };
