'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@/ui/primitives/checkbox';
import { Property } from '@/ui/layout/Property';
import type { KpiCreate, KpiPatch } from '../schema/validation';
import { useKpiFacets } from './queries';
// KPIS-B30: whether the owner hears of a period with no reading yet, beside the owner it reaches.
// A reminder only arrives at somebody with a workspace login, so the line under the box says
// whether this owner has one: a switch that is on and reaches nobody should not look like it works.
export function KpiReminder({
  initial,
  save,
}: {
  initial: KpiCreate;
  save?: ((patch: Omit<KpiPatch, 'revision'>) => void) | undefined;
}) {
  const t = useTranslations('kpis');
  const facets = useKpiFacets();
  const [enabled, setEnabled] = useState(initial.remindersEnabled);
  const owner = facets.data?.owners.find((row) => row.id === initial.ownerId);
  const name = owner?.name ?? '';
  const hint = !initial.ownerId
    ? t('reminderNoOwner')
    : owner?.hasLogin
      ? t('reminderReaches', { name })
      : t('reminderNoLogin', { name });
  const box = (
    <label className="grid gap-1 text-sm font-light">
      <span className="flex min-h-9 items-center gap-3">
        <Checkbox
          name="remindersEnabled"
          checked={enabled}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            save?.({ remindersEnabled: checked });
          }}
        />
        {t('remindersEnabled')}
      </span>
      <span className="text-xs text-text-muted">{hint}</span>
    </label>
  );
  return save ? <Property label={t('reminders')}>{box}</Property> : box;
}
