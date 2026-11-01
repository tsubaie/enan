'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { AiModel } from '@/core/config/ai-model-schema';
import { ChoiceSelect } from '@/ui/layout/ChoiceSelect';
import { Field } from '@/ui/layout/Field';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
type Model = z.infer<typeof AiModel>;
type Choice = { value: string; label: string; text: string };
type AiModelPickerProps = {
  models: Model[];
  value: string;
  setValue: (value: string) => void;
  label: string;
};
export function AiModelPicker({ models, value, setValue, label }: AiModelPickerProps) {
  const t = useTranslations('admin');
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const { matches, selected, modelChoices, providerChoices } = useModelChoices(
    models,
    value,
    search,
    provider,
  );
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <ModelFilters
        search={search}
        setSearch={setSearch}
        provider={provider}
        setProvider={setProvider}
        providerChoices={providerChoices}
      />
      <p role="status" className="text-xs text-text-muted">
        {t('aiMatchingModels', { count: matches.length, total: models.length })}
      </p>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{label}</span>
        <ChoiceSelect
          label={label}
          items={modelChoices}
          value={value}
          onChange={(next) => {
            if (models.some((model) => model.id === next)) setValue(next);
          }}
        />
      </div>
      {!selected && value && (
        <p role="alert" className="text-sm text-danger">
          {t('aiReplaceUnavailable')}
        </p>
      )}
      {!matches.length && <p className="text-sm text-text-muted">{t('aiNoMatchingModels')}</p>}
      {(search || provider) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            setProvider('');
          }}
        >
          {t('aiClearModelFilters')}
        </Button>
      )}
    </fieldset>
  );
}
// Every word of the search must appear in the model's id or name; the saved model stays listed
// even when the filters hide it, and a saved model the provider no longer offers is named as such.
function useModelChoices(models: Model[], value: string, search: string, provider: string) {
  const t = useTranslations('admin');
  const providers = [...new Set(models.map((model) => model.id.split('/')[0] ?? ''))].sort();
  const words = search.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const matches = models.filter(
    (model) =>
      (!provider || model.id.startsWith(`${provider}/`)) &&
      words.every((word) => `${model.id} ${model.name}`.toLowerCase().includes(word)),
  );
  const selected = models.find((model) => model.id === value);
  const shown =
    selected && !matches.some((model) => model.id === value) ? [selected, ...matches] : matches;
  const modelChoices: Choice[] = shown.map((model) => ({
    value: model.id,
    label: `${model.name} · ${model.id}`,
    text: `${model.name} ${model.id}`,
  }));
  if (!selected)
    modelChoices.unshift({
      value,
      label: value ? t('aiSelectionUnavailable', { model: value }) : t('aiChooseModel'),
      text: value,
    });
  const providerChoices: Choice[] = [
    { value: '', label: t('aiAllProviders'), text: t('aiAllProviders') },
    ...providers.map((name) => ({ value: name, label: name, text: name })),
  ];
  return { matches, selected, modelChoices, providerChoices };
}
function ModelFilters({
  search,
  setSearch,
  provider,
  setProvider,
  providerChoices,
}: {
  search: string;
  setSearch: (value: string) => void;
  provider: string;
  setProvider: (value: string) => void;
  providerChoices: Choice[];
}) {
  const t = useTranslations('admin');
  return (
    <>
      <Field label={t('aiSearchModels')}>
        {(control) => (
          <Input
            {...control}
            type="search"
            value={search}
            placeholder={t('aiSearchModelsPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{t('aiModelProvider')}</span>
        <ChoiceSelect
          label={t('aiModelProvider')}
          items={providerChoices}
          value={provider}
          onChange={setProvider}
        />
      </div>
    </>
  );
}
