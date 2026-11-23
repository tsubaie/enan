'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '@/core/http/client';
import { useToastManager } from '@/ui/primitives/toast';
import {
  recorderLimits,
  recordingFile,
  useVoiceRecorder,
  type Recording,
} from '@/modules/notes/ui';
import { CaptureRecorder, type Placement } from './CaptureRecorder';
import { useAfterStop } from './after-stop-toasts';
import { CaptureShortcut, type ShortcutKeys } from './CaptureShortcut';
import { registerCapture, setCaptureActive } from './capture-store';
import { focusWasLost } from './focus';
import { isWideScreen } from './inbox-state';
import { useLeaveWarning } from './outbox';
import { type Refusal } from './upload-refusal';
// S2 is shown once per browser; the browser's own prompt follows it.
const introKey = 'enan.captures.microphone-intro';
const wide = '(min-width: 1024px)';
const subscribeWidth = (change: () => void) => {
  const query = matchMedia(wide);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
};
function usePlacement(): Placement {
  const desktop = useSyncExternalStore(
    subscribeWidth,
    () => matchMedia(wide).matches,
    () => false,
  );
  return desktop ? 'desktop-floating' : 'mobile-fullscreen';
}
// S10: a recording started on a committee's page carries that committee until it is cleared.
function usePageCommittee() {
  const committeeId = useSearchParams().get('id');
  return usePathname() === '/committees' && z.uuid().safeParse(committeeId).success
    ? committeeId
    : null;
}
function useCommitteeName(committeeId: string | null) {
  return useQuery({
    queryKey: ['captures', 'committee', committeeId],
    enabled: Boolean(committeeId),
    queryFn: () =>
      request(`/committees/${committeeId}`, z.object({ data: z.object({ name: z.string() }) })),
  }).data?.data.name;
}
type Phase = 'idle' | 'intro' | 'recording';
// Starting goes through the store so a control's own click or key event asks for the microphone.
function useLauncher(launch: () => void) {
  const latest = useRef(launch);
  // sync: external system — the shell's controls start the recorder through the store.
  useEffect(() => {
    latest.current = launch;
  });
  // sync: external system — registered once for the shell's lifetime.
  useEffect(() => {
    registerCapture(() => latest.current());
    return () => registerCapture(null);
  }, []);
}
// CAPTURES-B01: a recorder closed without sending (Cancel, Discard, a dismissed sheet) returns
// focus to the control that opens it, after the next paint and only when focus was lost. A control
// the layout hides takes no focus, so the next one is tried. An opener marked `wide` (the avatar,
// whose menu holds Record on a computer, CAPTURES-B18) is visible on a phone too, so it is passed
// over there and the More tab is reached instead. The sheets' dismiss shares it: with no
// recording running, the recorder's cancel does nothing.
function useRefocus(close: () => void) {
  const frame = useRef(0);
  // sync: external system — a frame still pending at unmount is dropped.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return () => {
    close();
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (!focusWasLost()) return;
      const openers = [
        ...document.querySelectorAll<HTMLElement>(
          isWideScreen()
            ? '[data-capture-opener]:not([hidden])'
            : '[data-capture-opener]:not([hidden], [data-capture-opener="wide"])',
        ),
        document.querySelector<HTMLElement>('#content h1'),
      ];
      for (const node of openers) {
        node?.focus();
        if (node && document.activeElement === node) return;
      }
    });
  };
}
// The recording (or a picked file) goes to the outbox and the recorder closes at once (`sent`). A
// file picked from the refused-microphone sheet that the server refuses reopens the sheet with the
// reason instead of a toast (CAPTURES-B12, `reopen`). S8: just before 15:00 the hook stops by
// itself and the recording is kept, with a toast to say so.
function useSend(sent: () => void, reopen: () => void) {
  const t = useTranslations('captures');
  const toasts = useToastManager();
  const afterStop = useAfterStop();
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const recorder = useVoiceRecorder((recording: Recording) => {
    if (recording.seconds >= recorderLimits.stopSeconds) toasts.add({ title: t('limitReached') });
    afterStop.record(recordingFile(recording, t('fileName')), recording.seconds, committeeId);
    sent();
  });
  function pick(file: File) {
    setRefusal(null);
    afterStop.record(file, 0, committeeId, (refused) => {
      setRefusal(refused);
      reopen();
    });
    sent();
  }
  return { recorder, pick, committeeId, setCommitteeId, refusal, setRefusal };
}
// CAPTURES-B01 CAPTURES-B20: the one recorder of the shell. A control starts it (`startCapture`);
// Stop or an upload sends the audio to the outbox and closes the recorder at once, leaving the
// reader where they were; toasts say what became of it (no sheet after Stop). The shell mounts it
// only while recording is on (CAPTURES-B14), and the chord only with `keys`.
export function CaptureHost({ keys }: { keys: ShortcutKeys }) {
  const placement = usePlacement();
  const pageCommittee = usePageCommittee();
  const [phase, setPhase] = useState<Phase>('idle');
  useLeaveWarning();
  // Focus goes back to the opener only if it was lost with the recorder (toasts never take it).
  const sent = useRefocus(() => setPhase('idle'));
  const { recorder, pick, committeeId, setCommitteeId, refusal, setRefusal } = useSend(sent, () =>
    setPhase('recording'),
  );
  const committee = useCommitteeName(committeeId) ?? null;
  function begin() {
    localStorage.setItem(introKey, '1');
    setRefusal(null);
    setCommitteeId(pageCommittee);
    setPhase('recording');
    void recorder.start();
  }
  useLauncher(
    () => phase === 'idle' && (localStorage.getItem(introKey) ? begin() : setPhase('intro')),
  );
  const discard = useRefocus(() => {
    recorder.cancel();
    setPhase('idle');
  });
  const recording = phase === 'recording' && recorder.state !== 'idle';
  // sync: external system — the header and the phone button show a recording in progress.
  useEffect(() => setCaptureActive(recording), [recording]);
  const refused = phase === 'recording' && recorder.state === 'idle' && recorder.error !== null;
  return (
    <>
      {keys ? <CaptureShortcut /> : null}
      {(phase === 'intro' || refused) && (
        <CaptureRecorder.Permission
          kind={refused ? 'refused' : 'ask'}
          proceed={begin}
          dismiss={discard}
          pick={pick}
          refusal={refused ? refusal : null}
        />
      )}
      {recording && (
        <CaptureRecorder.Root
          recorder={recorder}
          placement={placement}
          committee={committee}
          clearCommittee={() => setCommitteeId(null)}
          discard={discard}
        >
          <CaptureRecorder.Surface />
          <CaptureRecorder.Actions />
        </CaptureRecorder.Root>
      )}
    </>
  );
}
