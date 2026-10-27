'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
// NOTES-B34: the browser's own recorder. WebM/Opus where the browser has it (Chromium, Firefox),
// MP4/AAC where it does not (Safari), at a voice bit rate: two minutes is about a megabyte.
export const recorderLimits = { maxSeconds: 900, bars: 24 };
const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
export type Recording = { blob: Blob; seconds: number; extension: string };
type Bars = RefObject<(HTMLElement | null)[]>;
type Session = {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  context: AudioContext | null;
  frame: number;
  tick: ReturnType<typeof setInterval> | undefined;
  lock: WakeLockSentinel | null;
  activeMs: number;
  resumedAt: number | null;
};
const secondsOf = (session: Session) =>
  Math.floor(
    (session.activeMs + (session.resumedAt === null ? 0 : Date.now() - session.resumedAt)) / 1000,
  );
async function openSession() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = mimes.find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 64000,
  });
  const session: Session = {
    stream,
    recorder,
    chunks: [],
    context: null,
    frame: 0,
    tick: undefined,
    lock: null,
    activeMs: 0,
    resumedAt: Date.now(),
  };
  recorder.ondataavailable = (event) => {
    if (event.data.size) session.chunks.push(event.data);
  };
  recorder.start(1000);
  return session;
}
// The 24-bar meter: each frame writes the bars' scale straight onto their elements.
function startMeter(session: Session, bars: Bars) {
  if (typeof AudioContext !== 'function') return;
  session.context = new AudioContext();
  const analyser = session.context.createAnalyser();
  analyser.fftSize = 128;
  session.context.createMediaStreamSource(session.stream).connect(analyser);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const draw = () => {
    analyser.getByteFrequencyData(data);
    const live = session.recorder.state === 'recording';
    bars.current.forEach((bar, index) => {
      // The lower half of the spectrum is where a voice is.
      const bin = Math.floor((index * data.length) / 2 / recorderLimits.bars);
      const level = live ? (data[bin] ?? 0) / 255 : 0;
      if (bar) bar.style.transform = `scaleY(${Math.max(0.08, level)})`;
    });
    session.frame = requestAnimationFrame(draw);
  };
  session.frame = requestAnimationFrame(draw);
}
function closeSession(session: Session) {
  cancelAnimationFrame(session.frame);
  clearInterval(session.tick);
  session.stream.getTracks().forEach((track) => track.stop());
  void session.context?.close();
  void session.lock?.release();
}
function finishSession(session: Session, onFinish: (recording: Recording) => void) {
  const seconds = secondsOf(session);
  const type = session.recorder.mimeType || 'audio/webm';
  session.recorder.onstop = () =>
    onFinish({
      blob: new Blob(session.chunks, { type }),
      seconds,
      extension: type.includes('mp4') ? 'm4a' : 'webm',
    });
  session.recorder.stop();
}
function togglePause(session: Session): 'paused' | 'recording' {
  if (session.recorder.state === 'recording') {
    session.recorder.pause();
    session.activeMs += Date.now() - (session.resumedAt ?? Date.now());
    session.resumedAt = null;
    return 'paused';
  }
  session.recorder.resume();
  session.resumedAt = Date.now();
  return 'recording';
}
// Stop keeping what was said (Stop & Attach, the time limit, leaving the note) or dropping it.
function release(session: Session, keep: boolean, onFinish: (recording: Recording) => void) {
  if (keep) finishSession(session, onFinish);
  else {
    session.recorder.onstop = null;
    session.recorder.stop();
  }
  closeSession(session);
}
async function holdScreen(session: Session, held: (on: boolean) => void) {
  session.lock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
  if (!session.lock) return;
  held(true);
  session.lock.addEventListener('release', () => held(false));
}
// What React renders (idle, recording or paused; whole seconds; the wake lock) is state; the
// meter's bars change every frame, so they live in `bars` and React never re-renders for them. A
// reader who asked for less motion gets still bars.
export function useVoiceRecorder(onFinish: (recording: Recording) => void) {
  const [state, setState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [wakeLock, setWakeLock] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const session = useRef<Session | null>(null);
  const bars = useRef<(HTMLElement | null)[]>([]);
  const end = (keep: boolean) => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    release(current, keep, (recording) => latest.current.onFinish(recording));
    setState('idle');
    setElapsed(0);
    setWakeLock(false);
  };
  const latest = useRef({ onFinish, end });
  // sync: external system — the recorder outlives a render, so it reads the latest callbacks.
  useEffect(() => {
    latest.current = { onFinish, end };
  });
  // sync: external system — leaving the note mid-recording attaches what was said, never drops it.
  useEffect(() => () => latest.current.end(true), []);
  async function start() {
    if (session.current) return;
    setError(null);
    try {
      const current = await openSession();
      session.current = current;
      current.tick = setInterval(() => {
        setElapsed(secondsOf(current));
        if (secondsOf(current) >= recorderLimits.maxSeconds) end(true);
      }, 250);
      startMeter(current, bars);
      setState('recording');
      await holdScreen(current, (on) => session.current === current && setWakeLock(on));
    } catch (failure) {
      end(false);
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    }
  }
  const toggle = () => session.current && setState(togglePause(session.current));
  const [stop, cancel] = [() => end(true), () => end(false)];
  return { state, elapsed, wakeLock, error, bars, start, toggle, stop, cancel };
}
