'use client';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Keyboard, Mic } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { CountCircle } from '@/ui/primitives/count-circle';
import { cn } from '@/ui/cn';
import { startCapture, useCaptureActive } from './capture-store';
import { useCaptureCount } from './capture-queries';
import type { ShortcutKeys } from './CaptureShortcut';
// CAPTURES-B17 CAPTURES-B18: the ways to start the one recorder, one variant per place it can live.
// Which of them the shell draws is `captureEntries` (entries.tsx); each carries its own breakpoint,
// so phone and computer are told apart by CSS alone. Every one is `data-capture-opener`, so focus
// can return to it when a recorder closes without sending (CAPTURES-B01).
const usePending = () => useCaptureCount().data?.data.pending ?? 0;
// S1: on a phone, a plain 56 px microphone above the navigation capsule, at the inline end (bottom
// left in Arabic) or the start. tokens.css hides it while the keyboard is open or a sheet hides
// the bar; it goes while a recording is active.
function Floating({ side }: { side: 'end' | 'start' }) {
  const t = useTranslations('captures');
  const active = useCaptureActive();
  if (active) return null;
  return (
    <button
      type="button"
      data-capture-opener
      data-capture-fab={side}
      aria-label={t('recordNote')}
      title={t('recordNote')}
      onClick={startCapture}
      className={cn(
        'fixed bottom-[calc(var(--mobile-nav-clear)+0.75rem)] z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden',
        side === 'end' ? 'end-4' : 'start-4',
      )}
    >
      <Mic aria-hidden className="size-6" />
    </button>
  );
}
// The title, the reader's own pending drafts (the Review badge's number, never `count && …`) and
// the count, as the More sheet and the account menu draw it.
function ActionBody({ keys }: { keys: ShortcutKeys }) {
  const t = useTranslations('captures');
  const count = usePending();
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <Mic aria-hidden className="size-5" />
      </span>
      <span className="grid min-w-0 flex-1 text-start">
        <span className="font-medium">{t('recordNote')}</span>
        {count > 0 ? (
          <span className="text-sm font-normal text-text-muted">
            {t.rich('pendingYours', { count, bdi: (text) => <bdi>{text}</bdi> })}
          </span>
        ) : null}
      </span>
      {count > 0 ? (
        <span aria-hidden>
          <CountCircle>{count}</CountCircle>
        </span>
      ) : null}
      {keys ? (
        <kbd translate="no" aria-hidden className="rounded border px-1.5 py-0.5 text-[11px]">
          {t('shortcut')}
        </kbd>
      ) : null}
    </>
  );
}
const action =
  'flex min-h-11 w-full items-center gap-3 rounded-xl border border-accent bg-accent-soft p-3 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
// The props a close part (the sheet's or the menu's) hands the action it draws: its own click,
// which closes, runs first, then the recorder starts in the same event, so the browser still sees
// the gesture that asks for the microphone.
type Part = Omit<ComponentProps<'button'>, 'children'>;
function ActionButton({ keys, className, onClick, ...part }: Part & { keys: ShortcutKeys }) {
  return (
    <button
      type="button"
      data-capture-opener
      aria-keyshortcuts={keys ?? undefined}
      {...part}
      className={cn(action, className)}
      onClick={(event) => {
        onClick?.(event);
        startCapture();
      }}
    >
      <ActionBody keys={keys} />
    </button>
  );
}
// CAPTURES-B17: Record as the first action of the More sheet, not a destination.
function MoreAction({ className, ...part }: Part) {
  return <ActionButton {...part} keys={null} className={cn('lg:hidden', className)} />;
}
// The More tab's dot, only while drafts are waiting.
function MoreDot() {
  const t = useTranslations('captures');
  return usePending() > 0 ? (
    <span
      data-capture-dot
      className="absolute top-1.5 end-[calc(50%-1rem)] size-2 rounded-full bg-accent"
    >
      <span className="sr-only">{t('pendingDot')}</span>
    </span>
  ) : null;
}
// S9: the computer's header control, with its chord on the keycap and the Mac spelling in the
// tooltip; with the shortcut off (CAPTURES-B19) it names no chord at all.
function Header({ keys }: { keys: ShortcutKeys }) {
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
// CAPTURES-B18: the top action of the account menu on a computer.
function MenuAction({ className, ...part }: Part & { keys: ShortcutKeys }) {
  return <ActionButton {...part} className={cn('max-lg:hidden', className)} />;
}
// CAPTURES-B18: the inbox header's Record, at every width while recording is on. With the header
// button hidden on a computer and the shortcut on, a quiet line names the chord beside it.
function Inbox({ hint }: { hint: 'shortcut' | null }) {
  const t = useTranslations('captures');
  const key = (text: ReactNode) => (
    <kbd translate="no" className="rounded border px-1.5 py-0.5 text-[11px]">
      {text}
    </kbd>
  );
  return (
    <>
      {hint === 'shortcut' ? (
        <p className="hidden items-center gap-1.5 self-center text-sm text-text-muted lg:inline-flex">
          <Keyboard aria-hidden className="size-4" />
          <span>{t.rich('recordHint', { key })}</span>
        </p>
      ) : null}
      <Button
        variant="outline"
        data-capture-opener
        aria-keyshortcuts={hint === 'shortcut' ? t('shortcut') : undefined}
        onClick={startCapture}
      >
        <Mic aria-hidden />
        {t('record')}
      </Button>
    </>
  );
}
export const CaptureEntry = { Floating, MoreAction, MoreDot, Header, MenuAction, Inbox };
