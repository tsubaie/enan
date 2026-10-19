'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Settings, UserCog } from 'lucide-react';
import { routes } from '@/core/routes';
import { PopoverContent } from '@/ui/primitives/popover';
import { Button } from '@/ui/primitives/button';
import { AccountActions } from './AccountActions';
// Everything behind the avatar. Kept out of AccountMenu so that the popover's positioner and the
// three actions' mutations are fetched when the reader opens the menu, not by every route.
//
// ADMIN-B19: Administration is an occasional destination for one role, so it lives here, under the
// reader's own account, rather than in the rail among the modules. Every line starts at the reading
// edge: right in Arabic, left in English, the name and the email included.
export function AccountPanel({
  user,
  onDone,
}: {
  user: { name: string; email: string; role: string };
  onDone: () => void;
}) {
  const t = useTranslations('common');
  return (
    <PopoverContent align="end" className="w-64 p-1.5">
      <div className="grid gap-0.5 border-b px-2.5 pt-1.5 pb-2.5 text-start">
        <p className="truncate font-medium">
          <bdi>{user.name}</bdi>
        </p>
        <p className="truncate text-xs text-text-muted" translate="no">
          <bdi dir="ltr">{user.email}</bdi>
        </p>
      </div>
      <div className="grid gap-0.5 pt-1.5">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 font-normal"
          nativeButton={false}
          render={<Link href={routes.account()} onClick={onDone} />}
        >
          <UserCog aria-hidden={true} className="size-4" />
          {t('account')}
        </Button>
        {user.role === 'admin' && (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2.5 font-normal"
            nativeButton={false}
            render={<Link href={routes.adminHome()} onClick={onDone} />}
          >
            <Settings aria-hidden={true} className="size-4" />
            {t('admin')}
          </Button>
        )}
        <AccountActions onDone={onDone} />
      </div>
    </PopoverContent>
  );
}
