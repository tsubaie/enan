import { type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/core/auth/session';
import { initialized } from '@/core/db/auth-repo';
import { getSetting } from '@/core/db/settings-repo';
import { db } from '@/core/db/client';
import { AppShell } from '@/ui/layout/AppShell';
import { routes } from '@/core/routes';
import { Providers } from '@/ui/layout/Providers';
import { readerCapture } from '@/modules/captures';
export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await initialized())) redirect(routes.setup());
  const user = await currentUser();
  if (!user) redirect(routes.login());
  const [workspace, capture] = await Promise.all([
    getSetting(db(), 'workspace.name'),
    readerCapture(user.id),
  ]);
  return (
    <Providers key={user.id}>
      <AppShell user={user} workspace={workspace} capture={capture}>
        {children}
      </AppShell>
    </Providers>
  );
}
