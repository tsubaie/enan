'use client';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { EntityPanel } from './EntityPanel';
import type { Entity } from './types';
import type { Surface } from './surface';
// The shape of a detail (title, a few property rows, a text block) while the item loads, so the
// panel reads as arriving rather than empty.
export function EntityDetailSkeleton() {
  const t = useTranslations('common');
  const rows = ['a', 'b', 'c', 'd'];
  return (
    <div role="status" className="animate-pulse p-4 lg:p-5">
      <span className="sr-only">{t('loading')}</span>
      <div aria-hidden className="grid gap-4">
        <div className="flex items-center gap-3">
          <span className="size-5 rounded-full bg-surface-raised" />
          <span className="h-6 w-3/4 rounded bg-surface-raised" />
        </div>
        <div className="grid gap-2">
          {rows.map((row) => (
            <div key={row} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
              <span className="h-3 w-14 rounded bg-surface-raised" />
              <span className="h-9 rounded-lg bg-surface-raised" />
            </div>
          ))}
        </div>
        <span className="h-24 rounded-lg bg-surface-raised" />
      </div>
    </div>
  );
}
export function EntityContent<T extends Entity, P extends object, C>({
  config,
  controller: c,
}: Surface<T, P, C>) {
  const t = useTranslations('common');
  if (c.state.creating)
    return (
      <>
        <CreateSheetBar close={c.close} />
        {config.renderers.create({
          cancel: c.close,
          pending: c.creating,
          submit: c.submit,
          open: (id) => c.navigate({ id, new: null }),
        })}
      </>
    );
  if (c.detail.pending) return <EntityDetailSkeleton />;
  if (c.detail.error || !c.detail.data)
    return (
      <div className="grid gap-4 p-6">
        <p>{t('notFound')}</p>
        {c.detail.error && <ErrorPanel error={c.detail.error} />}
        <Button onClick={c.close}>{t('close')}</Button>
      </div>
    );
  return (
    <EntityPanel
      key={c.detail.data.id}
      item={c.detail.data}
      mutations={config.mutations}
      render={config.renderers.detail}
      name={config.renderers.name(c.detail.data)}
      deletedMessage={config.renderers.deletedMessage}
      close={c.close}
      reload={c.detail.refetch}
      move={c.move}
      neighbors={c.neighbors}
      focus={c.state.focus}
      setFocus={(key) => c.navigate({ focus: key }, true)}
    />
  );
}
// Below 1024 px the create form opens in the same sheet as a record, so it carries the same top:
// the handle that says it can be pulled down, and the round close at the end edge (EntityPanel's
// bar). From 1024 px the form's own Cancel is the way out.
function CreateSheetBar({ close }: { close: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="panel-bar sticky top-0 z-20 flex min-h-12 items-center px-3 pt-4 pb-2 lg:hidden">
      <span
        aria-hidden={true}
        className="absolute inset-x-0 top-1.5 mx-auto h-1 w-9 rounded-full bg-text-muted/40"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('close')}
        onClick={close}
        className="ms-auto size-9 rounded-full bg-surface-raised"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
