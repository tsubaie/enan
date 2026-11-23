'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Inbox } from 'lucide-react';
import { routes } from '@/core/routes';
import { buttonVariants } from '@/ui/primitives/button';
import { CountCircle } from '@/ui/primitives/count-circle';
import { useCaptureCount } from './capture-queries';
import { CaptureReviewPanel } from './CaptureReviewPanel';
import { isWideScreen, setReviewPanel } from './inbox-state';
import type { CaptureSetup } from '../schema/validation';
// The header's record control, which the shell chose (`captureEntries`, CAPTURES-B18) and may be
// empty, then Review and its panel (S13). With recording off (CAPTURES-B14) only Review stays: the
// drafts already made are still the reader's to review.
export function CaptureHeaderControls({
  capture,
  record,
}: {
  capture: CaptureSetup;
  record: ReactNode;
}) {
  return (
    <>
      {record}
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
