'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
// The pieces the note types and note templates pages share: the save bar under each list, and the
// form that adds an entry by its identifier and a label per language.
const Id = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/u);
export function SaveBar({
  label,
  onSave,
  save,
}: {
  label: string;
  onSave: () => void;
  save: { isPending: boolean; isSuccess: boolean };
}) {
  const c = useTranslations('common');
  return (
    <div className="flex items-center gap-3">
      <Button onClick={onSave} disabled={save.isPending}>
        {label}
      </Button>
      {save.isSuccess && !save.isPending && (
        <span role="status" className="text-xs text-success">
          {c('saved')}
        </span>
      )}
    </div>
  );
}
type Labels = { id: string; en: string; ar: string; add: string };
export function AddEntryForm({
  names,
  taken,
  onAdd,
}: {
  names: Labels;
  taken: string[];
  onAdd: (id: string, labels: { en: string; ar: string }) => void;
}) {
  const [id, setId] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const valid = Id.safeParse(id).success && !taken.includes(id) && labelEn.trim() && labelAr.trim();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onAdd(id, { en: labelEn.trim(), ar: labelAr.trim() });
        setId('');
        setLabelEn('');
        setLabelAr('');
      }}
    >
      <Input
        aria-label={names.id}
        placeholder={names.id}
        value={id}
        className="w-40"
        onChange={(event) => setId(event.target.value.trim().toLowerCase())}
      />
      <Input
        aria-label={names.en}
        placeholder={names.en}
        value={labelEn}
        className="w-44"
        onChange={(event) => setLabelEn(event.target.value)}
      />
      <Input
        dir="rtl"
        aria-label={names.ar}
        placeholder={names.ar}
        value={labelAr}
        className="w-44"
        onChange={(event) => setLabelAr(event.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={!valid}>
        <Plus className="size-4" />
        {names.add}
      </Button>
    </form>
  );
}
