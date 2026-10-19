'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Input } from '@/ui/primitives/input';
import { Textarea } from '@/ui/primitives/textarea';
import { Checkbox } from '@/ui/primitives/checkbox';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { useSettings, useSaveSetting } from '@/modules/settings/ui';
import { NoteTemplate } from '../schema/validation';
import { useNoteTemplates } from './queries';
import { AddEntryForm, SaveBar } from './admin-pieces';
const Templates = z.array(NoteTemplate);
// ADMIN-B30 / NOTES-B27: the templates live in one setting. An empty `notes.templates` means the
// built-in two, which `GET /notes/templates` returns, so the editor seeds from it.
export function NoteTemplatesAdmin() {
  const t = useTranslations('admin');
  const settings = useSettings();
  const templates = useNoteTemplates();
  if (settings.isPending || templates.isPending) return <Loading />;
  if (settings.error) return <ErrorPanel error={settings.error} />;
  if (templates.error) return <ErrorPanel error={templates.error} />;
  const stored = Templates.safeParse(
    settings.data.data.find((row) => row.key === 'notes.templates')?.value,
  );
  return (
    <div className="grid gap-3">
      <h2 className="text-nav font-medium">{t('noteTemplatesTitle')}</h2>
      <p className="text-sm font-light text-text-muted">{t('noteTemplatesDescription')}</p>
      <TemplatesForm
        initial={stored.success && stored.data.length ? stored.data : templates.data.data}
      />
    </div>
  );
}
function TemplatesForm({ initial }: { initial: NoteTemplate[] }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const [draft, setDraft] = useState(initial);
  const save = useSaveSetting();
  const [error, setError] = useState<Error | null>(null);
  const update = (index: number, patch: Partial<NoteTemplate>) =>
    setDraft((current) =>
      current.map((template, i) => (i === index ? { ...template, ...patch } : template)),
    );
  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ key: 'notes.templates', value: draft });
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(c('error')));
    }
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-4">
        {draft.map((template, index) => (
          <TemplateRow
            key={template.id}
            template={template}
            onChange={(patch) => update(index, patch)}
          />
        ))}
      </div>
      <AddTemplate
        taken={draft.map((template) => template.id)}
        onAdd={(template) => setDraft((current) => [...current, template])}
      />
      {error && <ErrorPanel error={error} />}
      <SaveBar label={t('saveTemplates')} onSave={() => void submit()} save={save} />
    </div>
  );
}
// One template: its identifier, a label and a body per locale, and whether it is offered.
function TemplateRow({
  template,
  onChange,
}: {
  template: NoteTemplate;
  onChange: (patch: Partial<NoteTemplate>) => void;
}) {
  const t = useTranslations('admin');
  const text = (field: 'labels' | 'body', locale: 'en' | 'ar', value: string) =>
    onChange({
      [field]: { en: template[field].en ?? '', ar: template[field].ar ?? '', [locale]: value },
    });
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <legend className="font-mono text-xs">{template.id}</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-label={`${t('enabled')} ${template.id}`}
            checked={template.enabled}
            onCheckedChange={(checked) => onChange({ enabled: Boolean(checked) })}
          />
          {t('enabled')}
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Input
          aria-label={`${t('labelEn')} ${template.id}`}
          value={template.labels.en ?? ''}
          onChange={(event) => text('labels', 'en', event.target.value)}
        />
        <Input
          dir="rtl"
          aria-label={`${t('labelAr')} ${template.id}`}
          value={template.labels.ar ?? ''}
          onChange={(event) => text('labels', 'ar', event.target.value)}
        />
        <Textarea
          aria-label={`${t('bodyEn')} ${template.id}`}
          className="min-h-40 font-mono text-xs"
          value={template.body.en ?? ''}
          onChange={(event) => text('body', 'en', event.target.value)}
        />
        <Textarea
          dir="rtl"
          aria-label={`${t('bodyAr')} ${template.id}`}
          className="min-h-40 font-mono text-xs"
          value={template.body.ar ?? ''}
          onChange={(event) => text('body', 'ar', event.target.value)}
        />
      </div>
    </fieldset>
  );
}
function AddTemplate({
  taken,
  onAdd,
}: {
  taken: string[];
  onAdd: (template: NoteTemplate) => void;
}) {
  const t = useTranslations('admin');
  return (
    <AddEntryForm
      names={{
        id: t('templateId'),
        en: t('templateLabelEn'),
        ar: t('templateLabelAr'),
        add: t('addTemplate'),
      }}
      taken={taken}
      onAdd={(id, labels) => onAdd({ id, labels, body: { en: '', ar: '' }, enabled: true })}
    />
  );
}
