import { redirect } from 'next/navigation';
import { initialized } from '@/core/db/auth-repo';
import { db } from '@/core/db/client';
import { env } from '@/core/config/env';
import { signInMethods } from '@/core/auth/methods';
import { AuthForm } from '@/ui/layout/AuthForm';
import { routes } from '@/core/routes';
// ADMIN-B65: a Google sign-in that did not finish comes back here with Better Auth's reason. An
// account nobody added (sign-up is off) or one deactivated since reads as unknown; anything else
// as a sign-in that did not finish.
const unknown = new Set(['signup_disabled', 'INVALID_EMAIL_OR_PASSWORD', 'unable_to_create_user']);
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await initialized())) redirect(routes.setup());
  const { enabled } = await signInMethods(db());
  const error = (await searchParams).error;
  const notice =
    typeof error !== 'string' ? null : unknown.has(error) ? 'google_unknown' : 'google_failed';
  return (
    <AuthForm
      mode="login"
      recoveryEnabled={Boolean(env().RECOVERY_TOKEN)}
      methods={enabled}
      notice={notice}
    />
  );
}
