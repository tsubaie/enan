'use client';
import { useTranslations } from 'next-intl';
import { Inbox, Mic } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { startCapture } from './capture-store';
import { useInbox } from './inbox-state';
// S16: nothing waiting, and the way to record while recording is on (CAPTURES-B14), naming the
// chord only while the shortcut is (CAPTURES-B19).
export function InboxEmpty() {
  const t = useTranslations('captures');
  const { groups, capture } = useInbox();
  if (groups.length) return null;
  return (
    <div className="grid justify-items-center gap-3 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft">
        <Inbox aria-hidden className="size-7" />
      </span>
      <p className="font-medium">{t('emptyTitle')}</p>
      <p className="text-sm text-text-muted">{t('emptyHint')}</p>
      {capture.enabled ? (
        <Button
          variant="outline"
          onClick={startCapture}
          aria-keyshortcuts={capture.shortcut ? t('shortcut') : undefined}
        >
          <Mic aria-hidden />
          {t('recordNote')}
          {capture.shortcut ? (
            <kbd
              translate="no"
              aria-hidden
              className="hidden rounded border px-1.5 py-0.5 text-[11px] lg:inline"
            >
              {t('shortcut')}
            </kbd>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}
