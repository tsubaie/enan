'use client';
import { useTranslations } from 'next-intl';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/primitives/dialog';
import { CaptureUpload } from './CaptureUpload';
// S2 asks before the browser does, the first time only, and says the audio leaves the server
// when transcription is on; S3 explains a refusal and offers an upload instead.
export function CapturePermission({
  kind,
  proceed,
  dismiss,
  pick,
}: {
  kind: 'ask' | 'refused';
  proceed: () => void;
  dismiss: () => void;
  pick: (file: File) => void;
}) {
  const t = useTranslations('captures');
  const ask = kind === 'ask';
  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent sheet>
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          {ask ? <Mic aria-hidden /> : <MicOff aria-hidden />}
        </span>
        <DialogTitle>{ask ? t('permissionTitle') : t('refusedTitle')}</DialogTitle>
        <DialogDescription>{ask ? t('permissionBody') : t('refusedReason')}</DialogDescription>
        {!ask && <p className="text-sm text-text-muted">{t('refusedFormats')}</p>}
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
              <CaptureUpload pick={pick} />
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
