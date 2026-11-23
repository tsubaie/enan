'use client';
import { isValidElement, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell, Settings, UserCog } from 'lucide-react';
import { routes } from '@/core/routes';
import { PopoverClose, PopoverContent } from '@/ui/primitives/popover';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import { AccountActions } from './AccountActions';
// Everything behind the avatar. Kept out of AccountMenu so that the popover's positioner and the
// three actions' mutations are fetched when the reader opens the menu, not by every route.
//
// ADMIN-B19: Administration is an occasional destination for one role, so it lives here, under the
// reader's own account, rather than in the rail among the modules. Every line starts at the reading
// edge: right in Arabic, left in English, the name and the email included.
export function AccountPanel({
  user,
  record,
  onDone,
}: {
  user: { name: string; email: string; role: string };
  record: ReactNode;
  onDone: () => void;
}) {
  const t = useTranslations('common');
  const n = useTranslations('notifications');
  return (
    // Wider with the record action, so its title, count line, count and keycap fit as a row.
    <PopoverContent align="end" className={cn('p-1.5', record ? 'w-80' : 'w-64')}>
      <div className="grid gap-0.5 border-b px-2.5 pt-1.5 pb-2.5 text-start">
        <p className="truncate font-medium">
          <bdi>{user.name}</bdi>
        </p>
        <p className="truncate text-xs text-text-muted" translate="no">
          <bdi dir="ltr">{user.email}</bdi>
        </p>
      </div>
      <div className="grid gap-0.5 pt-1.5">
        {/* The action is drawn as the menu's close part, so its own click closes the menu too. */}
        {isValidElement(record) ? <PopoverClose render={record} /> : null}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 font-normal"
          nativeButton={false}
          render={<Link href={routes.account()} onClick={onDone} />}
        >
          <UserCog aria-hidden={true} className="size-4" />
          {t('account')}
        </Button>
        {/* NOTIF-B16: the full feed is a destination of the reader's own, like the account. */}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2.5 font-normal"
          nativeButton={false}
          render={<Link href={routes.notifications()} onClick={onDone} />}
        >
          <Bell aria-hidden={true} className="size-4" />
          {n('title')}
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
