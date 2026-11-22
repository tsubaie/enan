'use client';
import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, UserX } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Textarea } from '@/ui/primitives/textarea';
import { DatePicker } from '@/ui/layout/DatePicker';
import { CommitteePicker, useCommitteeChoices } from '@/modules/committees/ui';
import { TypeSelect } from '@/modules/notes/ui';
import {
  payloadFields,
  requiredFields,
  type FieldState,
  type PayloadFields,
  type Suggestion,
} from '../schema/validation';
import { Notice, OwnerSelect, PrioritySelect } from './field-controls';
export type Edit = (payload: PayloadFields) => void;
type Props = { draft: Suggestion; edit: Edit };
type DraftField =
  | 'title'
  | 'ownerId'
  | 'dueDate'
  | 'committeeId'
  | 'description'
  | 'priority'
  | 'type'
  | 'noteDate'
  | 'body';
type Choosable = 'committeeId' | 'type' | 'ownerId';
const choosable = (field: DraftField): field is Choosable =>
  field === 'committeeId' || field === 'type' || field === 'ownerId';
const fieldsOf: Record<Suggestion['kind'], DraftField[]> = {
  task: ['title', 'ownerId', 'dueDate', 'committeeId', 'description', 'priority'],
  meeting_note: ['title', 'type', 'noteDate', 'committeeId', 'body'],
  committee_note: ['title', 'committeeId', 'noteDate', 'body', 'type'],
};
const text = (payload: PayloadFields, key: string) => {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
};
// CAPTURES-B09: a field's state, in words and with an icon, never a percentage or colour alone.
export function fieldStateOf(draft: Suggestion, field: string): FieldState {
  const state = draft.fieldStates[field]?.state ?? 'confident';
  return state === 'several' && !draft.fieldStates[field]?.candidates.length ? 'unknown' : state;
}
const isRequired = (draft: Suggestion, field: string) =>
  requiredFields[draft.kind].some((name) => name === field);
// S19–S22: the editable fields of one draft, by kind. A text field saves when it is left; a
// choice saves when it is made. Each saved field becomes `confident` (the reviewer settled it).
export function SuggestionFields({ draft, edit }: Props) {
  const payload = payloadFields(draft.payload);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fieldsOf[draft.kind].map((field) => (
        <Field key={field} draft={draft} field={field} payload={payload} edit={edit} />
      ))}
    </div>
  );
}
function Field({
  draft,
  field,
  payload,
  edit,
}: Props & { field: DraftField; payload: PayloadFields }) {
  const t = useTranslations('captures');
  const id = useId();
  const wide = ['title', 'description', 'body', 'committeeId'].includes(field);
  const state = fieldStateOf(draft, field);
  return (
    <div className={wide ? 'grid gap-1 sm:col-span-2' : 'grid gap-1'}>
      <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-text-muted">
        {t(`field_${field}`)}
        <span aria-hidden className="h-3 w-px bg-border" />
        <span className="font-normal">
          {isRequired(draft, field) ? t('required') : t('optional')}
        </span>
      </label>
      {state === 'confident' || field === 'ownerId' ? null : (
        <Unsettled draft={draft} field={field} state={state} edit={edit} />
      )}
      {field === 'ownerId' && state !== 'confident' ? (
        <UnmatchedOwner draft={draft} edit={edit} id={id} />
      ) : (
        <Control id={id} field={field} payload={payload} edit={edit} />
      )}
    </div>
  );
}
function Control({
  id,
  field,
  payload,
  edit,
}: {
  id: string;
  field: DraftField;
  payload: PayloadFields;
  edit: Edit;
}) {
  const t = useTranslations('captures');
  const value = text(payload, field);
  const save = (next: string | null) => {
    if (next !== value) edit({ [field]: next });
  };
  if (field === 'title')
    return (
      <Input
        key={value}
        id={id}
        dir="auto"
        defaultValue={value ?? ''}
        onBlur={(e) => save(e.currentTarget.value.trim() || null)}
      />
    );
  if (field === 'description' || field === 'body')
    return (
      <Textarea
        key={value}
        id={id}
        dir="auto"
        rows={3}
        defaultValue={value ?? ''}
        onBlur={(e) => save(e.currentTarget.value.trim() || null)}
      />
    );
  if (field === 'dueDate' || field === 'noteDate')
    return (
      <DatePicker
        value={value}
        onChange={save}
        label={t(`field_${field}`)}
        clearable={field === 'dueDate'}
      />
    );
  if (field === 'committeeId') return <CommitteePicker value={value} onChange={save} />;
  if (field === 'type')
    return <TypeSelect value={value ?? ''} onChange={(next) => save(next || null)} />;
  if (field === 'ownerId') return <OwnerSelect id={id} value={value} onChange={save} />;
  return <PrioritySelect id={id} value={value} onChange={save} />;
}
// S20 several matches: the candidates as choices, with the full picker right below for any
// other; S21 unknown: what went unrecognised, and the picker.
function Unsettled({
  draft,
  field,
  state,
  edit,
}: Props & { field: DraftField; state: FieldState }) {
  const t = useTranslations('captures');
  const said = draft.fieldStates[field]?.sourceText;
  const candidates = draft.fieldStates[field]?.candidates ?? [];
  const choices = useCommitteeChoices();
  const names = new Map((choices.data?.data ?? []).map((row) => [row.id, row.name]));
  return (
    <div className="grid gap-2 rounded-lg border border-warning bg-warning-soft p-3">
      <Notice>
        <strong>
          {!choosable(field)
            ? t('requiredField')
            : state === 'several'
              ? t(`choose_${field}`)
              : t(`unknown_${field}`)}
        </strong>
        {said && state === 'several' && (
          <> {t('saidMatches', { said, count: candidates.length })}</>
        )}
      </Notice>
      {state === 'several' && choosable(field) && (
        <div role="group" aria-label={t(`choose_${field}`)} className="flex flex-wrap gap-2">
          {candidates.map((candidate) => (
            <Button
              key={candidate}
              variant="outline"
              size="sm"
              onClick={() => edit({ [field]: candidate })}
            >
              {names.get(candidate) ?? candidate}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
// S21, owner variant: optional, so it never blocks Approve. Choose opens the people picker; Clear
// leaves the task without an owner.
function UnmatchedOwner({ draft, edit, id }: Props & { id: string }) {
  const t = useTranslations('captures');
  const [choosing, setChoosing] = useState(false);
  const said = text(payloadFields(draft.payload), 'spokenOwner');
  return (
    <div className="grid gap-2 rounded-lg border border-warning bg-warning-soft p-3">
      <Notice>
        <strong>{t('unknown_ownerId')}</strong>
        {said && <> {t('saidNoMatch', { said })}</>}
      </Notice>
      {choosing ? (
        <OwnerSelect id={id} value={null} onChange={(value) => edit({ ownerId: value })} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setChoosing(true)}>
            <Search aria-hidden />
            {t('chooseOwner')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => edit({ ownerId: null })}>
            <UserX aria-hidden />
            {t('clearOwner')}
          </Button>
        </div>
      )}
      <Notice tone="info">{t('ownerOptional')}</Notice>
    </div>
  );
}
