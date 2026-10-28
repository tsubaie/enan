'use client';
import { Suspense, lazy } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { PersonFields, Kind } from '../schema/validation';
import { Field } from '@/ui/layout/Field';
import { Input } from '@/ui/primitives/input';
import { Segmented } from '@/ui/primitives/segmented';
import { Checkbox } from '@/ui/primitives/checkbox';
import { Button } from '@/ui/primitives/button';
import { Property, PropertySheet } from '@/ui/layout/Property';
import { TagsEditor } from '@/ui/tags/TagsEditor';
import { usePersonTags } from './queries';
const MarkdownField = lazy(() =>
  import('@/ui/markdown/MarkdownField').then((m) => ({ default: m.MarkdownField })),
);
export type Values = z.infer<typeof PersonFields>;
export type Patch = Partial<Values>;
const emptyPerson: Values = {
  fullName: '',
  displayName: null,
  honorific: null,
  organization: null,
  roleTitle: null,
  kind: 'external',
  email: null,
  phone: null,
  notes: null,
  tags: [],
  isAssignable: false,
  userId: null,
};
const textFields = z.enum([
  'fullName',
  'displayName',
  'honorific',
  'organization',
  'roleTitle',
  'email',
  'phone',
]);
function usePersonForm(initial: Values, save?: (patch: Patch) => void) {
  const form = useForm({ resolver: zodResolver(PersonFields), defaultValues: initial });
  return { form, initial, save };
}
type Editor = ReturnType<typeof usePersonForm>;
export function PersonForm({
  initial = emptyPerson,
  submit,
  save,
  pending = false,
}: {
  initial?: Values;
  submit?: (values: Values) => void;
  save?: (patch: Patch) => void;
  pending?: boolean;
}) {
  const c = useTranslations('common');
  const editor = usePersonForm(initial, save);
  return (
    // In a record the person's properties sit on one property sheet as rows and the notes are their
    // own section (docs/design-system.md § Records); the create form keeps a plain stack.
    <form
      className={save ? 'grid gap-6' : 'grid gap-5'}
      onSubmit={editor.form.handleSubmit((values) => submit?.(values))}
    >
      {save ? (
        <PropertySheet>
          <PersonProperties editor={editor} />
        </PropertySheet>
      ) : (
        <PersonProperties editor={editor} />
      )}
      <PersonNotes editor={editor} />
      {submit && (
        <Button type="submit" disabled={pending}>
          {pending ? c('saving') : c('create')}
        </Button>
      )}
    </form>
  );
}
function PersonProperties({ editor }: { editor: Editor }) {
  return (
    <>
      <PersonTextFields editor={editor} />
      <PersonKind editor={editor} />
      <PersonAssignable editor={editor} />
      <PersonTags editor={editor} />
    </>
  );
}
function PersonTextFields({ editor }: { editor: Editor }) {
  const t = useTranslations('people');
  const c = useTranslations('common');
  const { form, save } = editor;
  return (
    <>
      {textFields.options
        .filter((key) => !save || key !== 'fullName')
        .map((key) => (
          <Field
            key={key}
            label={t(key)}
            error={form.formState.errors[key]?.message}
            quiet={Boolean(save)}
            empty={!form.getValues(key)}
            row={Boolean(save)}
          >
            {(control) => (
              <Input
                type={key === 'email' ? 'email' : 'text'}
                placeholder={save ? c('addValue') : undefined}
                required={key === 'fullName'}
                {...control}
                {...form.register(key)}
                onBlur={async (event) => {
                  await form.register(key).onBlur(event);
                  if (await form.trigger(key)) save?.({ [key]: form.getValues(key) });
                }}
              />
            )}
          </Field>
        ))}
    </>
  );
}
// PEOPLE-B11: internal or external is a choice between two values worth seeing together, so it is
// the capsule segmented control rather than a menu that hides the other one.
function PersonKind({ editor }: { editor: Editor }) {
  const t = useTranslations('people');
  const c = useTranslations('common');
  const { form, save } = editor;
  const kind = useWatch({ control: form.control, name: 'kind' });
  // PEOPLE-B13: an internal record says whether it reaches a workspace login, which is what lets
  // its reminders and assignments arrive at all.
  const control = (
    <span className="grid gap-1">
      <Segmented
        label={t('kind')}
        value={kind}
        segments={Kind.options.map((value) => ({ value, label: c(value) }))}
        onChange={(next) => {
          form.setValue('kind', next);
          save?.({ kind: next });
        }}
      />
      {kind === 'internal' && (
        <span className="text-xs text-text-muted">
          {t(editor.initial.userId ? 'linkedLogin' : 'noLogin')}
        </span>
      )}
    </span>
  );
  if (save)
    return (
      <Property label={t('kind')} quiet>
        {control}
      </Property>
    );
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{t('kind')}</span>
      {control}
    </div>
  );
}
// In a record the checkbox is a row of the sheet like the others: its label in the label column,
// the box and what it means in the value column.
function PersonAssignable({ editor }: { editor: Editor }) {
  const t = useTranslations('people');
  const { form, save } = editor;
  const assignable = useWatch({ control: form.control, name: 'isAssignable' });
  const box = (
    <label className="flex min-h-9 items-center gap-3 text-sm font-light">
      <Checkbox
        checked={assignable}
        onCheckedChange={(checked) => {
          form.setValue('isAssignable', checked);
          save?.({ isAssignable: checked });
        }}
      />
      {t('isAssignable')}
    </label>
  );
  if (!save) return box;
  return <Property label={t('assignment')}>{box}</Property>;
}
// PEOPLE-B10: the shared tag field the notes use, offering the tags already used on people. In the
// create form the tags ride along with the other values; in a record each change saves.
function PersonTags({ editor }: { editor: Editor }) {
  const t = useTranslations('people');
  const { form, save } = editor;
  const tags = useWatch({ control: form.control, name: 'tags' });
  const query = usePersonTags();
  return (
    <TagsEditor
      label={t('tags')}
      stacked={!save}
      tags={tags}
      suggestions={{ tags: query.data?.data ?? [], refresh: () => void query.refetch() }}
      save={(next) => {
        form.setValue('tags', next);
        save?.({ tags: next });
      }}
    />
  );
}
// The notes read and edit the way a task's description does (docs/design-system.md § Records):
// markdown with a reading frame, an editor on focus, and the expanded view.
function PersonNotes({ editor }: { editor: Editor }) {
  const t = useTranslations('people');
  const { form, save, initial } = editor;
  return (
    <Suspense fallback={<div className="min-h-40 rounded-lg border" aria-busy />}>
      <MarkdownField
        name="notes"
        label={t('notes')}
        maxLength={50000}
        value={initial.notes ?? ''}
        onCommit={(value) => {
          const notes = value.trim() ? value : null;
          form.setValue('notes', notes);
          save?.({ notes });
        }}
      />
    </Suspense>
  );
}
