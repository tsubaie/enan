'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Inbox, Mic } from 'lucide-react';
import { routes } from '@/core/routes';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { CountCircle } from '@/ui/primitives/count-circle';
import { cn } from '@/ui/cn';
import { startCapture, useCaptureActive } from './capture-store';
import { useCaptureCount } from './capture-queries';
// S9: the desktop control, with its chord on the keycap and the Mac spelling in the tooltip.
function CaptureHeaderButton() {
  const t = useTranslations('captures');
  const active = useCaptureActive();
  return (
    <Button
      variant="outline"
      className={cn('hidden lg:inline-flex', active && 'border-accent bg-accent-soft')}
      title={t('shortcutMac')}
      aria-keyshortcuts={t('shortcut')}
      onClick={startCapture}
    >
      {active ? (
        <span aria-hidden className="size-2.5 rounded-full bg-danger" />
      ) : (
        <Mic aria-hidden />
      )}
      {t('recordNote')}
      <kbd translate="no" aria-hidden className="rounded border px-1.5 py-0.5 text-[11px]">
        {t('shortcut')}
      </kbd>
    </Button>
  );
}
// The header's two controls, recording and Review (S9, S13).
export function CaptureHeaderControls() {
  return (
    <>
      <CaptureHeaderButton />
      <CaptureReviewLink />
    </>
  );
}
// S13: Review, with the reader's own drafts waiting and failed recordings (CAPTURES-B02).
function CaptureReviewLink() {
  const t = useTranslations('captures');
  const count = useCaptureCount().data?.data.pending ?? 0;
  return (
    <Link
      href={routes.captures()}
      aria-label={count ? t('reviewCount', { count }) : t('review')}
      className={buttonVariants({ variant: 'ghost', className: 'gap-2' })}
    >
      <Inbox aria-hidden className="size-4" />
      <span aria-hidden className="hidden sm:inline">
        {t('review')}
      </span>
      {count > 0 && (
        <span aria-hidden>
          <CountCircle current>{count}</CountCircle>
        </span>
      )}
    </Link>
  );
}
