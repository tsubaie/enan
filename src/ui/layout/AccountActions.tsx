'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { routes } from '@/core/routes';
import { Button } from '@/ui/primitives/button';
// The actions behind the avatar. They are here rather than in AccountMenu so that the logout
// mutation is fetched when the menu is opened. The language is not here: it is the flag toggle
// beside the bell (LanguageToggle), one press from every page. There is no theme switch:
// the wallpaper an administrator chooses sets how light or dark the workspace feels (ADMIN-B42),
// and the plain light theme is kept as a fallback on the Account page (ACCT-B04).
export function AccountActions({ onDone }: { onDone: () => void }) {
  return <SignOut onDone={onDone} />;
}
function SignOut({ onDone }: { onDone: () => void }) {
  const t = useTranslations('common');
  const client = useQueryClient();
  const router = useRouter();
  const logout = useMutation({
    mutationFn: () =>
      request('/auth/logout', z.object({ data: z.null() }), { method: 'POST', body: {} }),
    onSuccess: () => {
      onDone();
      client.clear();
      router.push(routes.login());
      router.refresh();
    },
  });
  return (
    <Button
      variant="ghost"
      className="w-full justify-start gap-2.5 font-normal"
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
    >
      <LogOut aria-hidden={true} className="size-4 rtl:rotate-180" />
      {t('logout')}
    </Button>
  );
}
