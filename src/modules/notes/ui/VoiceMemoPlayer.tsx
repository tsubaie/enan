'use client';
import { useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Pause, Play, Trash2 } from 'lucide-react';
import { Button, buttonVariants } from '@/ui/primitives/button';
import type { NoteVoiceMemo } from '../schema/validation';
const rates = [1, 1.5, 2];
export const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
};
// The element is the browser's, not React's: position and speed are written onto it.
const set = (
  element: HTMLAudioElement | null,
  values: Partial<Pick<HTMLAudioElement, 'currentTime' | 'playbackRate'>>,
) => element && Object.assign(element, values);
// The player's state follows the element's own events. A recorded WebM carries no duration, so
// the length recorded with the memo stands in until the file reports its own.
function useAudio(audio: RefObject<HTMLAudioElement | null>, fallbackDuration: number) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [rate, setRate] = useState(1);
  return {
    playing,
    time,
    duration,
    rate,
    events: {
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onTimeUpdate: (event: { currentTarget: HTMLAudioElement }) =>
        setTime(event.currentTarget.currentTime),
      onLoadedMetadata: (event: { currentTarget: HTMLAudioElement }) => {
        if (Number.isFinite(event.currentTarget.duration))
          setDuration(event.currentTarget.duration);
      },
    },
    toggle: () => {
      if (audio.current?.paused) void audio.current.play();
      else audio.current?.pause();
    },
    seek: (next: number) => {
      set(audio.current, { currentTime: next });
      setTime(next);
    },
    nextRate: () => {
      const next = rates[(rates.indexOf(rate) + 1) % rates.length] ?? 1;
      set(audio.current, { playbackRate: next });
      setRate(next);
    },
  };
}
// NOTES-B30: play and pause, a scrubbing slider, 1x / 1.5x / 2x, download and delete.
export function VoiceMemoPlayer({ memo, remove }: { memo: NoteVoiceMemo; remove: () => void }) {
  const t = useTranslations('notes');
  const audio = useRef<HTMLAudioElement>(null);
  const player = useAudio(audio, memo.durationSeconds);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The transcript beside the player is the memo's text alternative. */}
      <audio ref={audio} src={memo.audioUrl} preload="metadata" {...player.events} />
      <Button
        size="icon-sm"
        variant="secondary"
        aria-label={player.playing ? t('pauseAudio') : t('playAudio')}
        onClick={player.toggle}
      >
        {player.playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <span className="text-xs text-text-muted tabular-nums">
        {t('recordingClock', { elapsed: clock(player.time), max: clock(player.duration) })}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(player.duration, 0)}
        step={0.1}
        value={Math.min(player.time, player.duration)}
        aria-label={t('seekAudio')}
        className="min-w-24 flex-1 accent-accent"
        onChange={(event) => player.seek(Number(event.currentTarget.value))}
      />
      <Button
        size="sm"
        variant="ghost"
        className="tabular-nums"
        aria-label={t('playbackSpeed', { rate: player.rate })}
        onClick={player.nextRate}
      >
        {t('speedValue', { rate: player.rate })}
      </Button>
      <a
        href={memo.audioUrl}
        download={memo.originalName}
        aria-label={t('downloadAudio')}
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
      >
        <Download aria-hidden />
      </a>
      <Button size="icon-sm" variant="ghost" aria-label={t('removeVoice')} onClick={remove}>
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}
