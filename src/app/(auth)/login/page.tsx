import { redirect } from 'next/navigation';
import { initialized } from '@/core/db/auth-repo';
import { db } from '@/core/db/client';
import { env } from '@/core/config/env';
import { signInMethods } from '@/core/auth/methods';
import { AuthForm } from '@/ui/layout/AuthForm';
import { routes } from '@/core/routes';
export default async function Page() {
  if (!(await initialized())) redirect(routes.setup());
  const { enabled } = await signInMethods(db());
  return (
    <AuthForm mode="login" recoveryEnabled={Boolean(env().RECOVERY_TOKEN)} methods={enabled} />
  );
}
