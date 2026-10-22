import { redirect } from 'next/navigation';
import { initialized } from '@/core/db/auth-repo';
import { db } from '@/core/db/client';
import { signInMethods } from '@/core/auth/methods';
import { CodeSignIn } from '@/ui/layout/CodeSignIn';
import { routes } from '@/core/routes';
export default async function Page() {
  if (!(await initialized())) redirect(routes.setup());
  const { enabled } = await signInMethods(db());
  if (!enabled.includes('code')) redirect(routes.login());
  return <CodeSignIn passwordEnabled={enabled.includes('password')} />;
}
