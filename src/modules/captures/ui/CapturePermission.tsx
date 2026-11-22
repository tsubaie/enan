'use client';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/primitives/dialog';
import { CaptureUpload } from './CaptureUpload';
import type { Refusal } from './upload-refusal';
// S2 asks before the browser does, the first time only, and says the audio leaves the server
// when transcription is on; S3 explains a refusal and offers an upload instead. A file the server
// refused brings S3 back with the reason, and focus on Upload audio to pick another.
export function CapturePermission({
  kind,
  proceed,
  dismiss,
  pick,
  refusal = null,
}: {
  kind: 'ask' | 'refused';
  proceed: () => void;
  dismiss: () => void;
  pick: (file: File) => void;
  refusal?: Refusal | null;
}) {
  const t = useTranslations('captures');
  const upload = useRef<HTMLButtonElement>(null);
  const ask = kind === 'ask';
  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent sheet initialFocus={refusal ? upload : undefined}>
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          {ask ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        </span>
        <DialogTitle>{ask ? t('permissionTitle') : t('refusedTitle')}</DialogTitle>
        <DialogDescription>{ask ? t('permissionBody') : t('refusedReason')}</DialogDescription>
        {!ask && <p className="text-sm text-text-muted">{t('refusedFormats')}</p>}
        {refusal && (
          <p role="alert" className="text-sm text-danger">
            {t(refusal)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {ask ? (
            <>
              <Button onClick={proceed}>{t('continue')}</Button>
              <Button variant="ghost" onClick={dismiss}>
                {t('notNow')}
              </Button>
            </>
          ) : (
            <>
              <CaptureUpload pick={pick} ref={upload} />
              <Button variant="outline" onClick={proceed}>
                {t('tryAgain')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
