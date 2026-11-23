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
import { CaptureReviewPanel } from './CaptureReviewPanel';
import { isWideScreen, setReviewPanel } from './inbox-state';
import type { CaptureSetup } from '../schema/validation';
import type { ShortcutKeys } from './CaptureShortcut';
// S9: the desktop control, with its chord on the keycap and the Mac spelling in the tooltip; with
// the shortcut off (CAPTURES-B19) it names no chord at all.
function CaptureHeaderButton({ keys }: { keys: ShortcutKeys }) {
  const t = useTranslations('captures');
  const active = useCaptureActive();
  return (
    <Button
      variant="outline"
      data-capture-opener
      className={cn('hidden lg:inline-flex', active && 'border-accent bg-accent-soft')}
      title={keys ? t('shortcutMac') : undefined}
      aria-keyshortcuts={keys ?? undefined}
      onClick={startCapture}
    >
      {active ? (
        <span aria-hidden className="size-2.5 rounded-full bg-danger" />
      ) : (
        <Mic aria-hidden />
      )}
      {t('recordNote')}
      {keys ? (
        <kbd translate="no" aria-hidden className="rounded border px-1.5 py-0.5 text-[11px]">
          {t('shortcut')}
        </kbd>
      ) : null}
    </Button>
  );
}
// The header's two controls, recording and Review (S9, S13). With recording off (CAPTURES-B14)
// only Review stays: the drafts already made are still the reader's to review.
export function CaptureHeaderControls({ capture }: { capture: CaptureSetup }) {
  return (
    <>
      {capture.enabled ? <CaptureHeaderButton keys={capture.shortcut ? 'Alt+V' : null} /> : null}
      <CaptureReviewLink />
      <CaptureReviewPanel capture={capture} />
    </>
  );
}
// S13: Review, with the reader's own drafts waiting and failed recordings (CAPTURES-B02). On a
// desktop it opens the side panel; on a phone, and without script, it is the page.
function CaptureReviewLink() {
  const t = useTranslations('captures');
  const count = useCaptureCount().data?.data.pending ?? 0;
  return (
    <Link
      href={routes.captures()}
      onClick={(event) => {
        if (!isWideScreen() || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        setReviewPanel(true);
      }}
      aria-label={count ? t('reviewCount', { count }) : t('review')}
      className={buttonVariants({
        variant: 'ghost',
        className: 'gap-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11',
      })}
    >
      <Inbox aria-hidden className="size-4" />
      <span aria-hidden className="hidden sm:inline">
        {t('review')}
      </span>
      {/* A real space, so the visible words read "Review 3", as the name does (WCAG 2.5.3). */}
      {count > 0 && ' '}
      {count > 0 && (
        <span aria-hidden>
          <CountCircle current>{count}</CountCircle>
        </span>
      )}
    </Link>
  );
}
