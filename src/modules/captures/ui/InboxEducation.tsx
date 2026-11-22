'use client';
import { useTranslations } from 'next-intl';
import { Eye, X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { dismissEducation, useEducationDismissed } from './inbox-state';
// S30: said once, until the reader dismisses it on this device (§9 decision 4).
export function InboxEducation() {
  const t = useTranslations('captures');
  if (useEducationDismissed()) return null;
  return (
    <p role="note" className="flex items-start gap-3 rounded-xl bg-accent-soft p-3 text-sm">
      <Eye aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">{t('education')}</span>
      <Button variant="ghost" size="icon-sm" aria-label={t('dismiss')} onClick={dismissEducation}>
        <X aria-hidden />
      </Button>
    </p>
  );
}
