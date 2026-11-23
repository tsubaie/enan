'use client';
import { createContext, use, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Landmark, Pause, Play, Square, Sun, X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import {
  RecorderMeter,
  clock,
  recorderKeys,
  recorderLimits,
  type useVoiceRecorder,
} from '@/modules/notes/ui';
import { CapturePermission } from './CapturePermission';
import { CaptureChoice, type Choice } from './CaptureChoice';
import { CaptureModal, type Placement } from './CaptureModal';
export type { Placement };
type Recorder = ReturnType<typeof useVoiceRecorder>;
// CAPTURES-B01 S4–S10: past five seconds a cancel asks first, and a warning appears from about a
// minute in; the hook itself stops and keeps the recording at 15:00.
export const recorderTimings = { confirmAfterSeconds: 5, warnAtSeconds: 60 };
type Value = {
  recorder: Recorder;
  placement: Placement;
  committee: string | null;
  clearCommittee: () => void;
  cancel: () => void;
};
const RecorderContext = createContext<Value | null>(null);
function useRecorder() {
  const value = use(RecorderContext);
  if (!value) throw new Error('CaptureRecorder parts render inside CaptureRecorder.Root');
  return value;
}
// Stable across renders, so the recorder takes focus once, when it appears.
const focusOnMount = (node: HTMLElement | null) => node?.focus();
const frame: Record<Placement, string> = {
  'mobile-fullscreen':
    'fixed inset-0 grid-rows-[1fr_auto] overscroll-contain bg-elevated px-[max(--spacing(5),env(safe-area-inset-left),env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]',
  'desktop-floating':
    'fixed end-4 bottom-4 w-[380px] gap-3 rounded-2xl border bg-elevated p-4 shadow-lg',
};
// Escape pauses and asks on a desktop (S10) and cancels on a phone; Space and Enter as for a memo.
function Root({
  recorder,
  placement,
  committee,
  clearCommittee,
  discard,
  children,
}: Omit<Value, 'cancel'> & { discard: () => void; children: ReactNode }) {
  const t = useTranslations('captures');
  const [choice, setChoice] = useState<Choice>(null);
  const resume = useRef(false);
  const ask = (next: Choice) => {
    resume.current = recorder.state === 'recording';
    if (resume.current) recorder.toggle();
    setChoice(next);
  };
  const cancel = () =>
    recorder.elapsed <= recorderTimings.confirmAfterSeconds ? discard() : ask('cancel');
  const keep = () => {
    setChoice(null);
    if (resume.current && recorder.state === 'paused') recorder.toggle();
  };
  const escape = placement === 'desktop-floating' ? () => ask('escape') : cancel;
  return (
    <RecorderContext value={{ recorder, placement, committee, clearCommittee, cancel }}>
      <CaptureModal placement={placement} label={t('recorderLabel')}>
        <form
          tabIndex={-1}
          ref={focusOnMount}
          aria-label={t('recorderLabel')}
          data-placement={placement}
          className={cn('z-40 grid outline-none', frame[placement])}
          onSubmit={(event) => {
            event.preventDefault();
            recorder.stop();
          }}
          onKeyDown={(event) => {
            if (!choice) recorderKeys(recorder, escape)(event);
          }}
        >
          {children}
        </form>
      </CaptureModal>
      <CaptureChoice
        choice={choice}
        keep={keep}
        save={() => {
          setChoice(null);
          recorder.stop();
        }}
        discard={() => {
          setChoice(null);
          discard();
        }}
      />
    </RecorderContext>
  );
}
function CommitteeChip() {
  const t = useTranslations('captures');
  const { committee, clearCommittee } = useRecorder();
  if (!committee) return null;
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
      <Landmark aria-hidden className="size-4" />
      {t('committeeChip', { name: committee })}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('clearCommittee')}
        onClick={clearCommittee}
      >
        <X aria-hidden />
      </Button>
    </span>
  );
}
function Status() {
  const t = useTranslations('captures');
  const { recorder, placement } = useRecorder();
  const paused = recorder.state === 'paused';
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-sm">
      <span role="status" className="inline-flex items-center gap-2 font-medium">
        <span
          aria-hidden
          className={cn('size-2.5 rounded-full bg-danger', !paused && 'motion-safe:animate-pulse')}
        />
        {paused ? t('paused') : t('recording')}
      </span>
      {recorder.wakeLock && (
        <span className="inline-flex items-center gap-1 text-text-muted">
          <Sun aria-hidden className="size-4" />
          {t('wakeLock')}
        </span>
      )}
      {placement === 'desktop-floating' && <Limit />}
    </div>
  );
}
function Limit() {
  const t = useTranslations('captures');
  return (
    <span className="text-sm text-text-muted">
      {t('limit', { max: clock(recorderLimits.maxSeconds) })}
    </span>
  );
}
// Status, the committee chip, the clock and the meter. The clock, the meter and the microphone
// are drawn left to right in both languages (they do not mirror in RTL).
function Surface() {
  const t = useTranslations('captures');
  const { recorder, placement } = useRecorder();
  const full = placement === 'mobile-fullscreen';
  return (
    <div className={cn('grid content-start gap-3', full && 'content-center justify-items-center')}>
      <Status />
      <CommitteeChip />
      <div className={cn('flex items-center gap-4', full ? 'flex-col' : 'justify-between')}>
        <span
          dir="ltr"
          data-testid="capture-clock"
          className={cn('font-light tabular-nums', full ? 'text-7xl' : 'text-4xl')}
        >
          {clock(recorder.elapsed)}
        </span>
        {full && <Limit />}
        <Meter />
      </div>
      {recorder.elapsed >= recorderTimings.warnAtSeconds && (
        <p role="note" className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-text-muted">
          {t('lengthWarning')}
        </p>
      )}
    </div>
  );
}
function Meter() {
  const { recorder } = useRecorder();
  return (
    <span dir="ltr" data-testid="capture-meter">
      <RecorderMeter bars={recorder.bars} />
    </span>
  );
}
function Key({ name }: { name: 'keyEscape' | 'keyEnter' }) {
  const t = useTranslations('captures');
  return (
    <kbd translate="no" className="rounded border px-1 text-[11px]">
      {t(name)}
    </kbd>
  );
}
function Actions() {
  const t = useTranslations('captures');
  const { recorder, placement, cancel } = useRecorder();
  const paused = recorder.state === 'paused';
  const full = placement === 'mobile-fullscreen';
  const size = full ? 'lg' : 'default';
  return (
    <div className="grid gap-2">
      <div className={cn('flex items-center gap-2', full && 'justify-around')}>
        <Button type="button" variant={full ? 'secondary' : 'ghost'} size={size} onClick={cancel}>
          <X aria-hidden />
          {t('cancel')}
          {!full && <Key name="keyEscape" />}
        </Button>
        <Button type="submit" size={size}>
          <Square aria-hidden />
          {full ? t('stop') : t('stopAndSave')}
          {!full && <Key name="keyEnter" />}
        </Button>
        <Button type="button" variant="outline" size={size} onClick={recorder.toggle}>
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? t('resume') : t('pause')}
        </Button>
      </div>
      {!full && <p className="text-xs text-text-muted">{t('cancelHint')}</p>}
    </div>
  );
}
// CAPTURES-B01: the recorder as parts, so a phone and a desktop compose the same pieces in their
// own frame (`placement`) rather than one component switching on flags.
export const CaptureRecorder = { Root, Permission: CapturePermission, Surface, Meter, Actions };
