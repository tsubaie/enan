'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Input } from '@/ui/primitives/input';
import { Checkbox } from '@/ui/primitives/checkbox';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { useSettings, useSaveSetting } from '@/modules/settings/ui';
import { NoteType } from '../schema/validation';
import { useNoteTypes } from './queries';
import { AddEntryForm, SaveBar } from './admin-pieces';
const Types = z.array(NoteType);
type Draft = { types: NoteType[]; defaultType: string };
// ADMIN-B08 / NOTES-B20: the note types live in two settings. An empty `notes.types` means the six
// defaults, which `GET /notes/types` returns with their catalog labels, so the editor seeds from it.
export function NoteTypesAdmin() {
  const t = useTranslations('admin');
  const settings = useSettings();
  const types = useNoteTypes();
  if (settings.isPending || types.isPending) return <Loading />;
  if (settings.error) return <ErrorPanel error={settings.error} />;
  if (types.error) return <ErrorPanel error={types.error} />;
  const rows = settings.data.data;
  const stored = Types.safeParse(rows.find((row) => row.key === 'notes.types')?.value);
  const defaultType = z
    .string()
    .nullable()
    .safeParse(rows.find((row) => row.key === 'notes.default_type')?.value);
  return (
    <div className="grid gap-3">
      <h2 className="text-nav font-medium">{t('noteTypesTitle')}</h2>
      <p className="text-sm font-light text-text-muted">{t('noteTypesDescription')}</p>
      <NoteTypesForm
        initial={{
          types: stored.success && stored.data.length ? stored.data : types.data.data,
          defaultType: (defaultType.success && defaultType.data) || '',
        }}
      />
    </div>
  );
}
function NoteTypesForm({ initial }: { initial: Draft }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const [draft, setDraft] = useState(initial);
  const save = useSaveSetting();
  const [error, setError] = useState<Error | null>(null);
  const update = (index: number, patch: Partial<NoteType>) =>
    setDraft((current) => ({
      ...current,
      types: current.types.map((type, i) => (i === index ? { ...type, ...patch } : type)),
    }));
  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({ key: 'notes.types', value: draft.types });
      const enabled = draft.types.some((type) => type.enabled && type.id === draft.defaultType);
      await save.mutateAsync({
        key: 'notes.default_type',
        value: enabled ? draft.defaultType : null,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error(c('error')));
    }
  }
  return (
    <div className="grid gap-4">
      <TypesTable
        draft={draft}
        update={update}
        setDefault={(id) => setDraft((s) => ({ ...s, defaultType: id }))}
      />
      <AddType
        taken={draft.types.map((type) => type.id)}
        onAdd={(type) => setDraft((current) => ({ ...current, types: [...current.types, type] }))}
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.defaultType === ''}
          onCheckedChange={(checked) => checked && setDraft((s) => ({ ...s, defaultType: '' }))}
        />
        {t('noDefault')}
      </label>
      {error && <ErrorPanel error={error} />}
      <SaveBar label={c('save')} onSave={() => void submit()} save={save} />
    </div>
  );
}
function TypesTable({
  draft,
  update,
  setDefault,
}: {
  draft: Draft;
  update: (index: number, patch: Partial<NoteType>) => void;
  setDefault: (id: string) => void;
}) {
  const t = useTranslations('admin');
  return (
    <table className="w-full overflow-hidden rounded-xl text-sm">
      <thead className="text-start text-xs text-text-muted">
        <tr>
          <th className="py-2 pe-3 text-start">{t('typeId')}</th>
          <th className="py-2 pe-3 text-start">{t('labelEn')}</th>
          <th className="py-2 pe-3 text-start">{t('labelAr')}</th>
          <th className="py-2 pe-3 text-start">{t('enabled')}</th>
          <th className="py-2 text-start">{t('defaultType')}</th>
        </tr>
      </thead>
      <tbody>
        {draft.types.map((type, index) => (
          <TypeRow
            key={type.id}
            type={type}
            isDefault={draft.defaultType === type.id}
            onChange={(patch) => update(index, patch)}
            onDefault={() => setDefault(type.id)}
          />
        ))}
      </tbody>
    </table>
  );
}
function TypeRow({
  type,
  isDefault,
  onChange,
  onDefault,
}: {
  type: NoteType;
  isDefault: boolean;
  onChange: (patch: Partial<NoteType>) => void;
  onDefault: () => void;
}) {
  const t = useTranslations('admin');
  const labels = type.labels ?? { en: '', ar: '' };
  const setLabel = (locale: 'en' | 'ar', value: string) =>
    onChange({ labels: { en: labels.en ?? '', ar: labels.ar ?? '', [locale]: value } });
  return (
    <tr className="border-t">
      <td className="py-2 pe-3 font-mono text-xs">{type.id}</td>
      <td className="py-2 pe-3">
        <Input
          aria-label={`${t('labelEn')} ${type.id}`}
          value={labels.en ?? ''}
          onChange={(event) => setLabel('en', event.target.value)}
        />
      </td>
      <td className="py-2 pe-3">
        <Input
          dir="rtl"
          aria-label={`${t('labelAr')} ${type.id}`}
          value={labels.ar ?? ''}
          onChange={(event) => setLabel('ar', event.target.value)}
        />
      </td>
      <td className="py-2 pe-3">
        <Checkbox
          aria-label={`${t('enabled')} ${type.id}`}
          checked={type.enabled}
          onCheckedChange={(checked) => onChange({ enabled: Boolean(checked) })}
        />
      </td>
      <td className="py-2">
        <input
          type="radio"
          name="defaultType"
          aria-label={`${t('defaultType')} ${type.id}`}
          checked={isDefault}
          disabled={!type.enabled}
          onChange={onDefault}
        />
      </td>
    </tr>
  );
}
function AddType({ taken, onAdd }: { taken: string[]; onAdd: (type: NoteType) => void }) {
  const t = useTranslations('admin');
  return (
    <AddEntryForm
      names={{ id: t('typeId'), en: t('labelEn'), ar: t('labelAr'), add: t('addType') }}
      taken={taken}
      onAdd={(id, labels) => onAdd({ id, labels, enabled: true })}
    />
  );
}
