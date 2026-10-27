'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCheck } from 'lucide-react';
import { routes } from '@/core/routes';
import { Button } from '@/ui/primitives/button';
import { Segmented } from '@/ui/primitives/segmented';
import { ChoiceSelect } from '@/ui/layout/ChoiceSelect';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { ShowMore, useShowMore } from '@/ui/layout/ShowMore';
import { NotificationGroup, type Notification } from '../schema/validation';
import { useMarkAllRead, useNotifications } from './queries';
import { NotificationRow } from './NotificationRow';
// NOTIF-B16: the whole feed, a destination like the account page (ACCT-B08) rather than a module.
// The filters live in the address (NOTIF-B14) and are only read here, so they change through the
// history API rather than a server round-trip (EP-B30). Like the audit log, the server narrows and
// the newest hundred that match are all on hand.
const groupKey: Record<
  NotificationGroup,
  'kindAll' | 'kindTasks' | 'kindNotes' | 'kindKpis' | 'kindAi' | 'kindUpdates'
> = {
  all: 'kindAll',
  tasks: 'kindTasks',
  notes: 'kindNotes',
  kpis: 'kindKpis',
  ai: 'kindAi',
  updates: 'kindUpdates',
};
type Filter = { unread: boolean; kind: NotificationGroup };
export function NotificationsPage() {
  const t = useTranslations('notifications');
  const params = useSearchParams();
  const unread = params.get('unread') === '1';
  const kind = NotificationGroup.catch('all').parse(params.get('kind') ?? 'all');
  const query = new URLSearchParams({ limit: '100' });
  if (unread) query.set('unread', '1');
  if (kind !== 'all') query.set('kind', kind);
  const path = `/notifications?${query}`;
  const feed = useNotifications(path);
  const markAll = useMarkAllRead();
  const items = feed.data?.data.items ?? [];
  const go = (next: Filter) =>
    window.history.replaceState(
      null,
      '',
      routes.notifications({
        unread: next.unread ? '1' : null,
        kind: next.kind === 'all' ? null : next.kind,
      }),
    );
  return (
    <div className="mx-auto max-w-2xl px-5 py-8 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 rounded-full font-normal"
          // The newest hundred that match decide it; an older unread one is a filter away.
          disabled={markAll.isPending || !items.some((item) => !item.readAt)}
          onClick={() => markAll.mutate(kind)}
        >
          <CheckCheck className="size-4 text-accent" aria-hidden />
          {t('markAllRead')}
        </Button>
      </div>
      <Filters filter={{ unread, kind }} go={go} />
      {feed.isPending ? (
        <Loading />
      ) : feed.error ? (
        <ErrorPanel error={feed.error} retry={() => void feed.refetch()} />
      ) : items.length ? (
        <Rows key={path} items={items} />
      ) : (
        // NOTIF-B12: the purpose, and nothing offered.
        <p className="rounded-xl border bg-bg/50 p-8 text-sm font-light text-text-muted">
          {t(unread ? 'caughtUp' : 'empty')}
        </p>
      )}
    </div>
  );
}
function Filters({ filter, go }: { filter: Filter; go: (next: Filter) => void }) {
  const t = useTranslations('notifications');
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Segmented
        label={t('show')}
        value={filter.unread ? 'unread' : 'all'}
        segments={[
          { value: 'all', label: t('showAll') },
          { value: 'unread', label: t('showUnread') },
        ]}
        onChange={(value) => go({ ...filter, unread: value === 'unread' })}
      />
      <div className="w-44 max-w-full">
        <ChoiceSelect
          label={t('kindFilter')}
          value={filter.kind}
          items={NotificationGroup.options.map((value) => ({
            value,
            label: t(groupKey[value]),
            text: t(groupKey[value]),
          }))}
          onChange={(kind) => go({ ...filter, kind })}
        />
      </div>
    </div>
  );
}
// EP-B47: twenty at a time, the next one fading beneath. Keyed on the filter, so a new filter
// starts again at twenty.
function Rows({ items }: { items: Notification[] }) {
  const router = useRouter();
  const { visible, peek, props } = useShowMore(items, 20);
  const row = (item: Notification) => (
    <NotificationRow key={item.id} item={item} showDate onOpen={() => router.push(item.href)} />
  );
  return (
    <div>
      <div className="grid gap-1">{visible.map(row)}</div>
      <ShowMore {...props} peek={peek && row(peek)} />
    </div>
  );
}
