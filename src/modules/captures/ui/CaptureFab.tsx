'use client';
import { useTranslations } from 'next-intl';
import { Mic } from 'lucide-react';
import { startCapture, useCaptureActive } from './capture-store';
// S1: on a phone, a 56 px microphone at the bottom inline-end corner (bottom-left in Arabic),
// above the navigation capsule and the safe area, on every main screen.
export function CaptureFab() {
  const t = useTranslations('captures');
  const active = useCaptureActive();
  if (active) return null;
  return (
    <button
      type="button"
      data-capture-opener
      data-capture-fab
      aria-label={t('recordNote')}
      title={t('recordNote')}
      onClick={startCapture}
      className="fixed end-4 bottom-[calc(var(--mobile-nav-clear)+0.75rem)] z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
    >
      <Mic aria-hidden className="size-6" />
    </button>
  );
}
