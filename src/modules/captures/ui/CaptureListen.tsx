'use client';
import { createContext, use, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import type { CaptureGroup, Suggestion } from '../schema/validation';
type Span = { start: number; end: number };
type Listening = {
  playing: boolean;
  highlight: Span | null;
  toggle: () => void;
  listen: (span: Span | null) => void;
};
const ListenContext = createContext<Listening | null>(null);
export function useListening() {
  const value = use(ListenContext);
  if (!value) throw new Error('CaptureListen.Provider is missing');
  return value;
}
// CAPTURES-B08: one player per recording. The provider returns no segment timestamps, so Listen
// plays the whole clip from the start and highlights the draft's sentence in the transcript.
function Provider({ group, children }: { group: CaptureGroup; children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [highlight, setHighlight] = useState<Span | null>(null);
  const value: Listening = {
    playing,
    highlight,
    toggle: () => {
      const element = audio.current;
      if (!element) return;
      if (element.paused) void element.play();
      else element.pause();
    },
    listen: (span) => {
      setHighlight(span);
      const element = audio.current;
      if (!element) return;
      element.currentTime = 0;
      void element.play();
    },
  };
  return (
    <ListenContext value={value}>
      <audio
        ref={audio}
        src={group.audioUrl}
        preload="none"
        data-testid="capture-audio"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {children}
    </ListenContext>
  );
}
// S15: the group's play/pause for the whole clip. The icon is not mirrored in RTL.
function PlayButton() {
  const t = useTranslations('captures');
  const { playing, toggle } = useListening();
  return (
    <Button
      size="icon"
      className="size-11 shrink-0 rounded-full"
      aria-label={playing ? t('pauseRecording') : t('playRecording')}
      aria-pressed={playing}
      onClick={toggle}
    >
      {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
    </Button>
  );
}
// The transcript with the listened-to sentence marked.
function Transcript({ text, span }: { text: string; span: Span | null }) {
  if (!span || span.end > text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, span.start)}
      <mark className="rounded bg-accent-soft text-text underline decoration-accent underline-offset-4">
        {text.slice(span.start, span.end)}
      </mark>
      {text.slice(span.end)}
    </>
  );
}
// S18 Source: the draft's sentence quoted from the transcript, and Listen.
function Source({ draft, transcript }: { draft: Suggestion; transcript: string | null }) {
  const t = useTranslations('captures');
  const { listen, highlight } = useListening();
  const span = draft.sourceSpans[0] ?? null;
  if (!span || !transcript) return null;
  const active = highlight?.start === span.start && highlight.end === span.end;
  return (
    <div className="grid gap-1 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">{t('source')}</span>
        <Button variant="outline" size="sm" onClick={() => listen(span)}>
          <Play aria-hidden />
          {t('listen')}
        </Button>
      </div>
      <blockquote
        dir="auto"
        className="border-s-2 border-accent ps-3 text-sm"
        data-active={active || undefined}
      >
        <mark className="rounded bg-accent-soft text-text">
          {transcript.slice(span.start, span.end)}
        </mark>
      </blockquote>
      <p className="text-xs text-text-muted">{t('listenHint')}</p>
    </div>
  );
}
// The group's whole transcript, behind Full transcript, with the listened-to sentence marked.
function FullTranscript({ text }: { text: string | null }) {
  const t = useTranslations('captures');
  const { highlight } = useListening();
  if (!text) return null;
  return (
    <details className="text-sm" open={highlight ? true : undefined}>
      <summary className="cursor-pointer font-medium">{t('fullTranscript')}</summary>
      <p
        dir="auto"
        data-testid="capture-transcript"
        className="mt-2 whitespace-pre-wrap text-text-muted"
      >
        <Transcript text={text} span={highlight} />
      </p>
    </details>
  );
}
export const CaptureListen = { Provider, PlayButton, Source, FullTranscript };
