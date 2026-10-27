'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell, CheckCheck } from 'lucide-react';
import { routes } from '@/core/routes';
import { useCount } from '@/ui/format';
import { Button } from '@/ui/primitives/button';
import { PopoverContent } from '@/ui/primitives/popover';
import { useMarkAllRead } from './queries';
import type { Notification } from '../schema/validation';
import { NotificationRow } from './NotificationRow';
// The centre itself. NOTIF-B12: the empty state names the purpose and offers nothing, because
// there is no action a reader can take that creates a notification. NOTIF-B15: it is a preview of
// the newest ten, unread first among them, and links to the page for the rest.
export function NotificationList({
  items,
  unread,
  total,
  pending,
  onOpen,
  onClose,
}: {
  items: Notification[];
  unread: number;
  total: number;
  pending: boolean;
  onOpen: (href: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('notifications');
  const count = useCount();
  const markAll = useMarkAllRead();
  return (
    <PopoverContent align="end" className="w-[25rem] p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          {unread > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold tabular-nums text-accent">
              {count(unread)}
            </span>
          )}
        </div>
        {unread > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal text-text-muted hover:text-text"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate(undefined)}
          >
            <CheckCheck className="size-3.5 text-accent" aria-hidden />
            {t('markAllRead')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-surface-raised text-text-muted">
            <Bell className="size-4" aria-hidden />
          </span>
          <p className="text-sm text-text-muted">{pending ? t('loading') : t('empty')}</p>
        </div>
      ) : (
        <Preview items={items} total={total} onOpen={onOpen} onClose={onClose} />
      )}
    </PopoverContent>
  );
}
function Preview({
  items,
  total,
  onOpen,
  onClose,
}: {
  items: Notification[];
  total: number;
  onOpen: (href: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('notifications');
  return (
    <>
      <div className="grid gap-1 p-2">
        {/* A stable sort, so the newest-first order holds within the unread and the read. */}
        {[...items]
          .sort((a, b) => Number(a.readAt !== null) - Number(b.readAt !== null))
          .map((item) => (
            <NotificationRow key={item.id} item={item} onOpen={() => onOpen(item.href)} />
          ))}
      </div>
      <div className="border-t border-border/70 p-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full font-normal text-accent"
          nativeButton={false}
          render={<Link href={routes.notifications()} onClick={onClose} />}
        >
          {total > items.length ? t('seeAllCount', { count: total }) : t('seeAll')}
        </Button>
      </div>
    </>
  );
}
