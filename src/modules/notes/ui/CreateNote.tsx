'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/ui/primitives/input';
import { Field } from '@/ui/layout/Field';
import { Property } from '@/ui/layout/Property';
import { DatePicker } from '@/ui/layout/DatePicker';
import { useToday } from '@/ui/format';
import { EntityCreateForm } from '@/ui/entity/EntityCreateForm';
import type { CreateApi } from '@/ui/entity/types';
import { NoteCreate, type NoteDetail } from '../schema/validation';
import { useNoteTypes } from './queries';
import { CommitteePicker } from '@/modules/committees/ui';
import { TemplateSelect, TypeSelect } from './NoteSelects';
import { QuickVoiceNoteBar } from './QuickVoiceNoteBar';
// Create asks for title, type, date and an optional template whose body becomes the content
// (notes.md § UI, NOTES-B27); everything else is added on the detail right after, with autosave.
export function CreateNote({
  api,
  committeeId = null,
}: {
  api: CreateApi<NoteCreate, NoteDetail>;
  committeeId?: string | null;
}) {
  const t = useTranslations('notes');
  const c = useTranslations('common');
  const [error, setError] = useState<Error | null>(null);
  const draft = useNoteDraft(committeeId);
  async function submit(form: FormData) {
    try {
      await api.submit(
        NoteCreate.parse({
          title: form.get('title'),
          committeeId: draft.committee,
          type: draft.type || null,
          noteDate: draft.noteDate ?? draft.today,
          content: draft.template.body,
        }),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(c('error')));
    }
  }
  return (
    <>
      <CreateFromVoice
        committeeId={draft.committee}
        type={draft.type || null}
        onCreated={api.open}
      />
      <EntityCreateForm
        title={t('newNote')}
        error={error}
        pending={api.pending}
        cancel={api.cancel}
        onSubmit={submit}
      >
        <Field label={t('title')}>
          {(control) => (
            <Input {...control} name="title" required pattern=".*\S.*" maxLength={500} />
          )}
        </Field>
        <CreateProperties committeeId={committeeId} draft={draft} />
      </EntityCreateForm>
    </>
  );
}
// What the form holds besides the title; the type falls back to the workspace default.
function useNoteDraft(committeeId: string | null) {
  const today = useToday();
  const types = useNoteTypes();
  const [type, setType] = useState('');
  const [noteDate, setNoteDate] = useState<string | null>(today);
  const [template, setTemplate] = useState({ id: '', body: '' });
  const [committee, setCommittee] = useState(committeeId);
  const fallback = types.data?.meta.defaultType ?? '';
  return {
    today,
    type: type || fallback,
    setType,
    noteDate,
    setNoteDate,
    template,
    setTemplate,
    committee,
    setCommittee,
  };
}
// NOTES-B36: the recorder is its own form, so it sits before the create form, not inside it.
function CreateFromVoice(props: Parameters<typeof QuickVoiceNoteBar>[0]) {
  return (
    <div className="px-5 pt-5">
      <QuickVoiceNoteBar {...props} />
    </div>
  );
}
function CreateProperties({
  committeeId,
  draft,
}: {
  committeeId: string | null;
  draft: ReturnType<typeof useNoteDraft>;
}) {
  const t = useTranslations('notes');
  const committees = useTranslations('committees');
  return (
    <div className="grid gap-2">
      <Property label={committees('committee')}>
        <CommitteePicker value={committeeId} name="committeeId" onChange={draft.setCommittee} />
      </Property>
      <Property label={t('type')}>
        <TypeSelect value={draft.type} onChange={draft.setType} />
      </Property>
      <Property label={t('date')}>
        <DatePicker value={draft.noteDate} onChange={draft.setNoteDate} label={t('date')} />
      </Property>
      <Property label={t('template')}>
        <TemplateSelect
          value={draft.template.id}
          label={t('template')}
          onPick={(id, body) => draft.setTemplate({ id, body })}
        />
      </Property>
    </div>
  );
}
