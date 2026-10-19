'use client';
import { useTranslations } from 'next-intl';
import { Property } from '@/ui/layout/Property';
import { DatePicker } from '@/ui/layout/DatePicker';
import type { NoteDetail } from '../schema/validation';
import { TypeSelect } from './NoteSelects';
// The note's type and date as the record edits them: a draft that is re-based on each save.
export type Properties = { type: string; noteDate: string | null };
// Type and date, controlled from the draft (useDraftProperties); rows of the property sheet.
export function TypeAndDate({
  note,
  draft,
  change,
}: {
  note: NoteDetail;
  draft: Properties;
  change: (patch: Partial<Properties>) => void;
}) {
  const t = useTranslations('notes');
  return (
    <>
      <Property label={t('type')} quiet empty={!draft.type}>
        <TypeSelect
          value={draft.type}
          current={note.type ?? ''}
          onChange={(next) => change({ type: next })}
        />
      </Property>
      <Property label={t('date')} quiet empty={!draft.noteDate}>
        <DatePicker
          value={draft.noteDate}
          label={t('date')}
          onChange={(next) => next && change({ noteDate: next })}
        />
      </Property>
    </>
  );
}
