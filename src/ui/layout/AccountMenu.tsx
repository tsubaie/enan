'use client';
import { Suspense, lazy, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Avatar } from './Avatar';
import { Popover, PopoverTrigger } from '@/ui/primitives/popover';
import { Button } from '@/ui/primitives/button';
// ACCT: the reader's own controls, gathered behind their own face. Theme and locale used to sit
// loose in the header as two permanent buttons for a decision made twice a year (05 § Layout
// shell); they are preferences, so they live with the account that holds them and with the page
// that also sets them.
const AccountPanel = lazy(() =>
  import('./AccountPanel').then((module) => ({ default: module.AccountPanel })),
);
// `record` is an action the panel puts first on a computer (CAPTURES-B18). It opens from inside the
// menu, so there the avatar is where focus returns when a recorder it started closes
// (`data-capture-opener="wide"`: on a phone the avatar is shown but holds no Record).
export function AccountMenu({
  user,
  record,
}: {
  user: { name: string; email: string; role: string };
  record: ReactNode;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-capture-opener={record ? 'wide' : undefined}
        render={<Button variant="ghost" size="icon" className="rounded-full" />}
      >
        <Avatar name={user.name} decorative className="size-7" />
        <span className="sr-only">{t('account')}</span>
      </PopoverTrigger>
      {/* The panel — its positioner, its portal and the three actions inside it — arrives when the
          menu is first opened. Only the avatar and its trigger belong on every route. */}
      {open && (
        <Suspense fallback={null}>
          <AccountPanel user={user} record={record} onDone={() => setOpen(false)} />
        </Suspense>
      )}
    </Popover>
  );
}
