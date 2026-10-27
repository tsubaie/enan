'use client';
import { useId, useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Mic, Pause, Play, Square, Upload, X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Chip } from '@/ui/entity/Card';
import { recorderLimits, type Recording, type useVoiceRecorder } from './use-voice-recorder';
import { clock } from './VoiceMemoPlayer';
type Recorder = ReturnType<typeof useVoiceRecorder>;
const barIds = Array.from({ length: recorderLimits.bars }, (_, index) => index);
const accepted = '.m4a,.mp3,.wav,.webm,.ogg,audio/*';
// Stable across renders, so the bar takes focus once, when it appears, and not on every tick.
const focusOnMount = (node: HTMLElement | null) => node?.focus();
export const recordingFile = (recording: Recording, name: string) =>
  new File([recording.blob], `${name}.${recording.extension}`, { type: recording.blob.type });
// One press to start recording, or a recording made elsewhere (a phone's voice memo, a message).
export function VoiceCapture({
  disabled,
  record,
  pick,
}: {
  disabled: boolean;
  record: () => Promise<void>;
  pick: (file: File, seconds: number) => void;
}) {
  const t = useTranslations('notes');
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void record()}>
        <Mic aria-hidden />
        {t('recordVoice')}
      </Button>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => input.current?.click()}>
        <Upload aria-hidden />
        {t('uploadAudio')}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accepted}
        hidden
        data-testid="voice-file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) pick(file, 0);
        }}
      />
    </div>
  );
}
// Keys act on the bar itself, so a focused button still behaves as a button: Space pauses or
// resumes, Enter stops and attaches; Escape cancels from anywhere inside.
function recorderKeys(recorder: Recorder) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    const own = event.target === event.currentTarget;
    const actions: Record<string, (() => void) | null> = {
      Escape: recorder.cancel,
      ' ': own ? recorder.toggle : null,
      Enter: own ? recorder.stop : null,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
}
// NOTES-B34: the live recorder — the pulsing dot, the clock against the limit, the screen kept
// awake, the 24-bar meter and the three ways out.
export function VoiceRecorderBar({ recorder }: { recorder: Recorder }) {
  const t = useTranslations('notes');
  const keys = useId();
  const paused = recorder.state === 'paused';
  return (
    <form
      ref={focusOnMount}
      tabIndex={-1}
      aria-label={t('recorderLabel')}
      aria-describedby={keys}
      className="grid gap-3 rounded-xl border border-danger/40 bg-danger-soft p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onSubmit={(event) => {
        event.preventDefault();
        recorder.stop();
      }}
      onKeyDown={recorderKeys(recorder)}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span aria-hidden className="size-2.5 rounded-full bg-danger motion-safe:animate-pulse" />
        <span role="status" className="font-medium">
          {paused ? t('recordingPaused') : t('recording')}
        </span>
        <span className="text-text-muted tabular-nums">
          {t('recordingClock', {
            elapsed: clock(recorder.elapsed),
            max: clock(recorderLimits.maxSeconds),
          })}
        </span>
        {recorder.wakeLock && <Chip>{t('wakeLockActive')}</Chip>}
      </div>
      <RecorderMeter bars={recorder.bars} />
      <RecorderControls recorder={recorder} paused={paused} />
      <p id={keys} className="text-xs text-text-muted">
        {t('recorderKeys')}
      </p>
    </form>
  );
}
// Each bar registers its element; the recorder's frame loop scales it without a render.
function RecorderMeter({ bars }: { bars: Recorder['bars'] }) {
  return (
    <div aria-hidden data-testid="voice-meter" className="flex h-8 items-center gap-0.5">
      {barIds.map((bar) => (
        <span
          key={bar}
          ref={(node) => {
            bars.current[bar] = node;
          }}
          className="h-full w-1 origin-center scale-y-[0.08] rounded-full bg-danger transition-transform duration-75"
        />
      ))}
    </div>
  );
}
function RecorderControls({ recorder, paused }: { recorder: Recorder; paused: boolean }) {
  const t = useTranslations('notes');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={recorder.toggle}>
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        {paused ? t('resumeRecording') : t('pauseRecording')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={recorder.cancel}>
        <X aria-hidden />
        {t('cancelRecording')}
      </Button>
      <Button type="submit" size="sm">
        <Square aria-hidden />
        {t('stopAndAttach')}
      </Button>
    </div>
  );
}
