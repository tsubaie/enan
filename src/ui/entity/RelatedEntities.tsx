'use client';
import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/ui/primitives/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/ui/primitives/dialog';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { ShowMore } from '@/ui/layout/ShowMore';
import Loading from '@/ui/layout/Loading';
import { ChoiceSelect } from '@/ui/layout/ChoiceSelect';
import { EntityPanel } from './EntityPanel';
import { useEntityNavigation } from './navigation';
import type { Entity, EntityPageProps, Filters } from './types';
type RelatedProps<T extends Entity, P extends object, C> = {
  config: EntityPageProps<T, P, C>;
  filters: Filters;
  allowCreate?: boolean;
};
// One embedded workflow for linked work: reuse each module's rows, create form and detail panel.
export function RelatedEntities<T extends Entity, P extends object, C>({
  config,
  filters,
  allowCreate = true,
}: RelatedProps<T, P, C>) {
  const c = useTranslations('common');
  const guarded = useEntityNavigation();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState(filters.view);
  const list = config.useList({ ...filters, view });
  const close = () =>
    guarded(() => {
      setSelected(null);
      setCreating(false);
    });
  return (
    <section className="space-y-3">
      <RelatedHeader
        config={config}
        view={view}
        setView={setView}
        allowCreate={allowCreate}
        create={() => guarded(() => setCreating(true))}
      />
      {list.pending && <Loading />}
      {list.error && <ErrorPanel error={list.error} retry={list.refetch} />}
      {!list.pending && !list.items.length && (
        <p className="py-4 text-sm text-text-muted">{c('noMatches')}</p>
      )}
      <RelatedRows
        config={config}
        items={list.items}
        open={(id) => guarded(() => setSelected(id))}
      />
      <ShowMore shown={list.items.length} more={list.more} onMore={list.fetchMore} />
      <RelatedDialog
        config={config}
        creating={creating}
        selected={selected}
        close={close}
        open={(id) => {
          setCreating(false);
          setSelected(id);
        }}
      />
    </section>
  );
}
function RelatedHeader<T extends Entity, P extends object, C>({
  config,
  view,
  setView,
  allowCreate,
  create,
}: {
  config: EntityPageProps<T, P, C>;
  view: string;
  setView: (view: string) => void;
  allowCreate: boolean;
  create: () => void;
}) {
  const c = useTranslations('common');
  return (
    <div className="flex items-center justify-between gap-2">
      <ChoiceSelect
        label={config.title}
        value={view}
        onChange={setView}
        items={config.filters.views.map((item) => ({
          value: item.id,
          text: item.label,
          label: item.label,
        }))}
      />
      <Button size="sm" disabled={!allowCreate} onClick={create}>
        {c('create')}
      </Button>
    </div>
  );
}
// A group heading goes above the first row of each run of rows that share a group.
function RelatedRows<T extends Entity, P extends object, C>({
  config,
  items,
  open,
}: {
  config: EntityPageProps<T, P, C>;
  items: T[];
  open: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {config.group?.(item) &&
            (index === 0 || config.group(item) !== config.group(items[index - 1] ?? item)) && (
              <li className="pt-3 pb-1 text-xs font-medium text-text-muted">
                {config.group(item)}
              </li>
            )}
          <li className="flex flex-wrap items-center gap-2 rounded-xl border p-2">
            {config.rowAction?.(item)}
            <Button
              variant="ghost"
              className="h-auto min-h-11 min-w-0 flex-1 justify-start text-start"
              onClick={() => open(item.id)}
            >
              {config.renderers.row(item)}
            </Button>
            <div className="ms-auto text-xs">{config.renderers.rowTrail?.(item)}</div>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}
// The create form, or the selected record's panel, in one dialog. A created record opens in it.
function RelatedDialog<T extends Entity, P extends object, C>({
  config,
  creating,
  selected,
  close,
  open,
}: {
  config: EntityPageProps<T, P, C>;
  creating: boolean;
  selected: string | null;
  close: () => void;
  open: (id: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const detail = config.useDetail(selected, false);
  const submit = async (input: C) => {
    setPending(true);
    try {
      const item = await config.mutations.create(input);
      if (item) open(item.id);
      return item;
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={creating || selected !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) close();
      }}
    >
      <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle className="sr-only">{config.title}</DialogTitle>
        <DialogDescription className="sr-only">{config.description}</DialogDescription>
        {creating ? (
          config.renderers.create({ pending, cancel: close, submit, open })
        ) : detail.pending ? (
          <Loading />
        ) : detail.error ? (
          <ErrorPanel error={detail.error} />
        ) : detail.data ? (
          <EntityPanel
            item={detail.data}
            name={config.renderers.name(detail.data)}
            deletedMessage={config.renderers.deletedMessage}
            mutations={config.mutations}
            render={config.renderers.detail}
            reload={detail.refetch}
            close={close}
            move={() => undefined}
            neighbors={{ previous: false, next: false, position: 1, count: 1 }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
