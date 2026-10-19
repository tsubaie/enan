'use client';
import { Suspense, lazy, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { ChoiceSelect } from '@/ui/layout/ChoiceSelect';
import { Scope, Status, type CommitteeCreate, type CommitteePatch } from '../schema/validation';
const MarkdownField = lazy(() =>
  import('@/ui/markdown/MarkdownField').then((m) => ({ default: m.MarkdownField })),
);
type Save = (patch: Omit<CommitteePatch, 'revision'>) => void;
// A committee's properties sit on one property sheet as rows, the way a task's and a note's do;
// the description is its own section under it (docs/design-system.md § Records). In a record the
// name is the editable heading above the sheet, so it has no row here; the create form passes no
// `save` and keeps the name and every label above its field.
export function CommitteeFields({
  initial,
  save,
  nameError,
}: {
  initial: CommitteeCreate;
  save?: Save;
  nameError?: string | undefined;
}) {
  const t = useTranslations('committees');
  const c = useTranslations('common');
  const reading = Boolean(save);
  const rows = (
    <>
      {!reading && (
        <Field label={t('name')} error={nameError}>
          {(control) => (
            <Input
              {...control}
              name="name"
              required
              pattern=".*\S.*"
              maxLength={500}
              defaultValue={initial.name}
            />
          )}
        </Field>
      )}
      <CommitteeChoices initial={initial} save={save} quiet={reading} />
      <Field label={t('ownership')} quiet={reading} row={reading} empty={!initial.ownership}>
        {(control) => (
          <Input
            {...control}
            name="ownership"
            placeholder={reading ? c('addValue') : undefined}
            maxLength={500}
            defaultValue={initial.ownership}
            onBlur={(event) => {
              if (event.target.value.trim() !== initial.ownership)
                save?.({ ownership: event.target.value.trim() });
            }}
          />
        )}
      </Field>
    </>
  );
  return (
    <fieldset data-autosave={save ? true : undefined} className="grid gap-6">
      {reading ? <PropertySheet>{rows}</PropertySheet> : rows}
      <CommitteeDescription initial={initial} save={save} />
    </fieldset>
  );
}
function CommitteeChoices({
  initial,
  save,
  quiet,
}: {
  initial: CommitteeCreate;
  save?: Save | undefined;
  quiet: boolean;
}) {
  const t = useTranslations('committees');
  const [properties, setProperties] = useState({ scope: initial.scope, status: initial.status });
  const [seen, setSeen] = useState(properties);
  if (seen.scope !== initial.scope || seen.status !== initial.status) {
    const next = { scope: initial.scope, status: initial.status };
    setSeen(next);
    setProperties(next);
  }
  return (
    <>
      <Property label={t('scope')} quiet={quiet}>
        <ChoiceSelect
          label={t('scope')}
          name="scope"
          value={properties.scope}
          items={Scope.options.map((scope) => ({ value: scope, text: t(scope), label: t(scope) }))}
          onChange={(scope) => {
            setProperties((value) => ({ ...value, scope }));
            save?.({ scope });
          }}
        />
      </Property>
      <Property label={t('status')} quiet={quiet}>
        <ChoiceSelect
          label={t('status')}
          name="status"
          value={properties.status}
          items={Status.options.map((status) => ({
            value: status,
            text: t(status),
            label: t(status),
          }))}
          onChange={(status) => {
            setProperties((value) => ({ ...value, status }));
            save?.({ status });
          }}
        />
      </Property>
    </>
  );
}
// The description reads and edits the way a task's does: markdown with a reading frame and an
// editor on focus (docs/design-system.md § Records). `name` keeps it in the create form's post.
function CommitteeDescription({
  initial,
  save,
}: {
  initial: CommitteeCreate;
  save?: Save | undefined;
}) {
  const t = useTranslations('committees');
  return (
    <Suspense fallback={<div className="min-h-40 rounded-lg border" aria-busy />}>
      <MarkdownField
        name="description"
        label={t('description')}
        maxLength={50000}
        value={initial.description}
        onCommit={(description) => {
          if (description !== initial.description) save?.({ description });
        }}
      />
    </Suspense>
  );
}
