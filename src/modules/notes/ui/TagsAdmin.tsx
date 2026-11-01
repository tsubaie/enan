'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Checkbox } from '@/ui/primitives/checkbox';
import { Field } from '@/ui/layout/Field';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { ManageTags } from '../schema/validation';
import { useManagedTags, useManageTags } from './tag-queries';

type TagRow = NonNullable<ReturnType<typeof useManagedTags>['data']>['data'][number];
type Mutation = ReturnType<typeof useManageTags>;

export function TagsAdmin() {
  const t = useTranslations('tagAdmin');
  const query = useManagedTags();
  const mutation = useManageTags();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('');
  const [pending, setPending] = useState<ManageTags | null>(null);
  const tags = query.data?.data ?? [];
  const current = selected.filter((tag) => tags.some((row) => row.tag === tag));
  const stage = (name: string | null) => {
    const parsed = ManageTags.safeParse({ tags: current, target: name });
    if (parsed.success) {
      mutation.reset();
      setPending(parsed.data);
    }
  };
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  const toggle = (tag: string, checked: boolean) =>
    setSelected(checked ? [...current, tag] : current.filter((value) => value !== tag));
  return (
    <section className="space-y-4 rounded-xl border bg-bg/50 p-5">
      <h2 className="text-nav font-medium">{t('title')}</h2>
      <p className="text-sm text-text-muted">{t('help')}</p>
      <fieldset disabled={mutation.isPending || pending !== null} className="space-y-4">
        <TagPicker
          tags={tags}
          search={search}
          setSearch={setSearch}
          current={current}
          toggle={toggle}
        />
        <p className="text-sm text-text-muted">{t('selected', { count: current.length })}</p>
        <TagTarget target={target} setTarget={setTarget} current={current} stage={stage} />
      </fieldset>
      <TagOutcome
        pending={pending}
        mutation={mutation}
        cancel={() => setPending(null)}
        done={() => {
          setPending(null);
          setSelected([]);
          setTarget('');
        }}
      />
    </section>
  );
}

function TagPicker({
  tags,
  search,
  setSearch,
  current,
  toggle,
}: {
  tags: TagRow[];
  search: string;
  setSearch: (value: string) => void;
  current: string[];
  toggle: (tag: string, checked: boolean) => void;
}) {
  const t = useTranslations('tagAdmin');
  const shown = tags.filter((row) => row.tag.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <>
      <Field label={t('search')}>
        {(control) => (
          <Input {...control} value={search} onChange={(event) => setSearch(event.target.value)} />
        )}
      </Field>
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {shown.map((row) => (
          <label key={row.tag} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
            <Checkbox
              checked={current.includes(row.tag)}
              onCheckedChange={(checked) => toggle(row.tag, checked === true)}
            />
            <bdi className="flex-1">{row.tag}</bdi>
            <span className="text-text-muted">{t('usage', { count: row.count })}</span>
          </label>
        ))}
        {!shown.length && <p className="text-sm text-text-muted">{t('empty')}</p>}
      </div>
    </>
  );
}

function TagTarget({
  target,
  setTarget,
  current,
  stage,
}: {
  target: string;
  setTarget: (value: string) => void;
  current: string[];
  stage: (name: string | null) => void;
}) {
  const t = useTranslations('tagAdmin');
  return (
    <>
      <Field label={t('target')}>
        {(control) => (
          <Input
            {...control}
            maxLength={50}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!ManageTags.safeParse({ tags: current, target }).success}
          onClick={() => stage(target)}
        >
          {t('merge')}
        </Button>
        <Button
          variant="secondary"
          disabled={!current.length || current.length > 200}
          onClick={() => stage(null)}
        >
          {t('delete')}
        </Button>
      </div>
    </>
  );
}

// The staged change waits for a second press, then the result or the error takes its place.
function TagOutcome({
  pending,
  mutation,
  cancel,
  done,
}: {
  pending: ManageTags | null;
  mutation: Mutation;
  cancel: () => void;
  done: () => void;
}) {
  const t = useTranslations('tagAdmin');
  const c = useTranslations('common');
  return (
    <>
      {pending && (
        <div className="space-y-3 rounded-lg border border-accent p-4">
          <TagConfirmation target={pending.target} />
          <p dir="auto" className="text-sm text-text-muted">
            {pending.tags.join('، ')}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(pending, { onSuccess: done })}
            >
              {mutation.isPending ? c('saving') : t('confirm')}
            </Button>
            <Button variant="secondary" disabled={mutation.isPending} onClick={cancel}>
              {c('cancel')}
            </Button>
          </div>
        </div>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-success">
          {t('updated', { count: mutation.data.data.updatedCount })}
        </p>
      )}
      {mutation.error && <ErrorPanel error={mutation.error} />}
    </>
  );
}

function TagConfirmation({ target }: { target: string | null }) {
  const t = useTranslations('tagAdmin');
  return <p>{target === null ? t('confirmDelete') : t('confirmMerge', { target })}</p>;
}
