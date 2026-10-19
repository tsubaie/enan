'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { useToastManager } from '@/ui/primitives/toast';
import { useGlide } from '@/ui/layout/use-glide';
import { useObjectives, useObjectiveMutations, useObjectiveOrder } from './queries';
import type { Objective } from '../schema/validation';
// KPIS-B06: the short list a scorecard is organised by. Order is the plan's order, so it is set by
// hand rather than sorted; deleting one keeps its KPIs, which then read as belonging to an
// archived objective instead of losing their place.
export function ObjectivesAdmin() {
  const t = useTranslations('kpis');
  const c = useTranslations('common');
  const query = useObjectives();
  const mutations = useObjectiveMutations();
  const reorder = useObjectiveOrder();
  const saved = query.data?.data ?? [];
  // The new order shows at once and glides into place; it stays until the write has landed.
  const [pending, setPending] = useState<Objective[] | null>(null);
  const rows = pending ?? saved;
  const glide = useGlide(rows.map((row) => row.id));
  const toasts = useToastManager();
  const remove = useMutation({
    mutationFn: (row: Objective) => mutations.remove(row.id, row.revision),
  });
  const move = useMutation({
    mutationFn: (next: Objective[]) =>
      reorder(next.map((row) => ({ id: row.id, revision: row.revision }))),
    onSuccess: () => toasts.add({ title: c('orderSaved') }),
    onError: () => toasts.add({ title: c('orderNotSaved') }),
    onSettled: () => setPending(null),
  });
  function shift(index: number, by: number) {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    if (row) next.splice(index + by, 0, row);
    setPending(next);
    move.mutate(next);
  }
  return (
    <section className="space-y-4">
      <p className="text-sm font-light text-text-muted">{t('objectivesIntro')}</p>
      {query.error && <ErrorPanel error={query.error} />}
      {remove.error && <ErrorPanel error={remove.error} />}
      {move.error && <ErrorPanel error={move.error} />}
      <ObjectiveForm />
      {query.isPending && <p role="status">{c('loading')}</p>}
      {!query.isPending && rows.length === 0 && (
        <p className="text-sm text-text-muted">{t('noObjectives')}</p>
      )}
      <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border bg-bg/50 empty:hidden">
        {rows.map((row, index) => (
          <li key={row.id} ref={glide(row.id)} className="relative">
            <ObjectiveRow
              row={row}
              first={index === 0}
              last={index === rows.length - 1}
              busy={move.isPending}
              move={(by) => shift(index, by)}
              remove={() => remove.mutate(row)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
function ObjectiveForm() {
  const t = useTranslations('kpis');
  const c = useTranslations('common');
  const mutations = useObjectiveMutations();
  const [draft, setDraft] = useState('');
  const create = useMutation({
    mutationFn: () => mutations.create({ name: draft.trim(), description: '' }),
    onSuccess: () => setDraft(''),
  });
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) create.mutate();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('newObjective')}>
          {(control) => (
            <Input
              {...control}
              required
              maxLength={500}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {c('create')}
        </Button>
      </div>
      {create.error && <ErrorPanel error={create.error} />}
    </form>
  );
}
function ObjectiveRow({
  row,
  first,
  last,
  move,
  remove,
  busy,
}: {
  row: Objective;
  first: boolean;
  last: boolean;
  busy: boolean;
  move: (by: number) => void;
  remove: () => void;
}) {
  const t = useTranslations('kpis');
  const mutations = useObjectiveMutations();
  return (
    // One row of the sheet: the name fills the row at one size for every objective, the KPI count
    // has a column of its own so a longer count never narrows the name, then the row's controls.
    <div className="property-quiet flex items-center gap-2 px-3 py-1.5">
      <Input
        aria-label={t('name')}
        maxLength={500}
        defaultValue={row.name}
        className="min-w-0 flex-1 text-sm"
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (name && name !== row.name)
            void mutations.patch(row.id, { name, revision: row.revision });
        }}
      />
      <span className="w-20 shrink-0 text-xs font-light text-text-muted">
        {t('kpiCount', { count: row.kpiCount })}
      </span>
      <MoveButtons row={row} first={first} last={last} busy={busy} move={move} />
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-danger"
        aria-label={t('deleteObjective', { name: row.name })}
        onClick={remove}
      >
        <Trash2 className="size-4" aria-hidden={true} />
      </Button>
    </div>
  );
}
function MoveButtons({
  row,
  first,
  last,
  busy,
  move,
}: {
  row: Objective;
  first: boolean;
  last: boolean;
  busy: boolean;
  move: (by: number) => void;
}) {
  const t = useTranslations('kpis');
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={first || busy}
        aria-label={t('moveUp', { name: row.name })}
        onClick={() => move(-1)}
      >
        <ChevronUp className="size-4" aria-hidden={true} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={last || busy}
        aria-label={t('moveDown', { name: row.name })}
        onClick={() => move(1)}
      >
        <ChevronDown className="size-4" aria-hidden={true} />
      </Button>
    </>
  );
}
