'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Maximize2, X } from 'lucide-react';
import { routes } from '@/core/routes';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { Dialog, DialogContent, DialogTitle } from '@/ui/primitives/dialog';
import { CaptureInbox } from './CaptureInbox';
import { setReviewPanel, useReviewPanel } from './inbox-state';
import type { CaptureSetup } from '../schema/validation';
// S14 on a desktop: Review opens beside the page, drafts edited inline; expand opens the page.
export function CaptureReviewPanel({ capture }: { capture: CaptureSetup }) {
  const t = useTranslations('captures');
  const open = useReviewPanel();
  const close = () => setReviewPanel(false);
  return (
    <Dialog open={open} onOpenChange={setReviewPanel}>
      <DialogContent
        showCloseButton={false}
        className="inset-y-4 start-auto end-4 top-4 w-[min(36rem,calc(100vw-2rem))] max-w-none translate-none overflow-y-auto p-6 sm:max-w-none rtl:translate-none"
      >
        <DialogTitle className="sr-only">{t('review')}</DialogTitle>
        {open && (
          <CaptureInbox.Root
            layout="panel"
            capture={capture}
            actions={
              <>
                <Link
                  href={routes.captures()}
                  onClick={close}
                  aria-label={t('openPage')}
                  className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                >
                  <Maximize2 aria-hidden />
                </Link>
                <Button variant="ghost" size="icon" aria-label={t('closePanel')} onClick={close}>
                  <X aria-hidden />
                </Button>
              </>
            }
          >
            <CaptureInbox.Off />
            <CaptureInbox.Education />
            <CaptureInbox.Groups />
            <CaptureInbox.Empty />
          </CaptureInbox.Root>
        )}
      </DialogContent>
    </Dialog>
  );
}
