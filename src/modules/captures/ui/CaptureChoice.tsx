'use client';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui/primitives/dialog';
export type Choice = 'cancel' | 'escape' | null;
// S6 and the S10 Escape sheet. Keep recording is the default: it has focus, and closing the sheet
// any other way keeps recording too, so neither Escape nor a stray click loses a word.
export function CaptureChoice({
  choice,
  keep,
  save,
  discard,
}: {
  choice: Choice;
  keep: () => void;
  save: () => void;
  discard: () => void;
}) {
  const t = useTranslations('captures');
  const keepButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={choice !== null} onOpenChange={(open) => !open && keep()}>
      <DialogContent showCloseButton={false} initialFocus={keepButton}>
        <DialogTitle>{choice === 'escape' ? t('escapeTitle') : t('cancelTitle')}</DialogTitle>
        <DialogDescription>
          {choice === 'escape' ? t('escapeHint') : t('cancelBody')}
        </DialogDescription>
        <DialogFooter>
          {choice === 'escape' && (
            <Button variant="outline" onClick={save}>
              {t('stopAndSave')}
            </Button>
          )}
          <Button ref={keepButton} onClick={keep}>
            {t('keepRecording')}
          </Button>
          <Button variant="destructive" onClick={discard}>
            {t('discardRecording')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
