'use client';
import { useTranslations } from 'next-intl';
import { MicOff } from 'lucide-react';
import { useInbox } from './inbox-state';
// CAPTURES-B14: while the workspace has recording off, the inbox says so and that the drafts
// already made can still be reviewed. A note, not an alert: nothing went wrong.
export function RecordingOff() {
  const t = useTranslations('captures');
  const { capture } = useInbox();
  if (capture.allowed) return null;
  return (
    <div role="note" className="grid gap-1 rounded-xl border border-warning bg-warning-soft p-4">
      <p className="flex items-start gap-2 font-medium">
        <MicOff aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t('recordingOffTitle')}
      </p>
      <p className="text-sm">{t('recordingOffBody')}</p>
    </div>
  );
}
