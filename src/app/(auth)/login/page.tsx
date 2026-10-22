import { redirect } from 'next/navigation';
import { z } from 'zod';
import { initialized } from '@/core/db/auth-repo';
import { db } from '@/core/db/client';
import { env } from '@/core/config/env';
import { signInMethods } from '@/core/auth/methods';
import { AuthForm } from '@/ui/layout/AuthForm';
import { routes } from '@/core/routes';
// ADMIN-B65: a Google sign-in that did not finish comes back here saying why.
const Notice = z.enum(['google_failed', 'google_unknown']);
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await initialized())) redirect(routes.setup());
  const { enabled } = await signInMethods(db());
  const notice = Notice.safeParse((await searchParams).error);
  return (
    <AuthForm
      mode="login"
      recoveryEnabled={Boolean(env().RECOVERY_TOKEN)}
      methods={enabled}
      notice={notice.success ? notice.data : null}
    />
  );
}
