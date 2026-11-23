'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, request } from '@/core/http/client';
import { useToastManager } from '@/ui/primitives/toast';
import {
  recorderLimits,
  recordingFile,
  useVoiceRecorder,
  type Recording,
} from '@/modules/notes/ui';
import { CaptureRecorder, type Placement } from './CaptureRecorder';
import { CaptureProcessing, stageOf } from './CaptureProcessing';
import { CaptureShortcut, type ShortcutKeys } from './CaptureShortcut';
import { registerCapture, setCaptureActive } from './capture-store';
import { focusWasLost } from './focus';
import { isWideScreen } from './inbox-state';
import { refusalOf, type Refusal } from './upload-refusal';
import { useCapture, useCreateCapture } from './capture-queries';
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
type Phase = 'idle' | 'intro' | 'recording' | 'after';
type Source = 'recorder' | 'sheet';
// Sending the audio: it becomes a capture and nothing else. One that does not reach the server is
// held in this tab only, for Retry (S12). A refused recording stays held with the reason; a
// refused file from the S3 sheet reopens the sheet with the reason; anything else is said and the
// panel closes.
function useSend(opened: () => void, closed: (source: Source) => void) {
  const t = useTranslations('captures');
  const toasts = useToastManager();
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const create = useCreateCapture();
  const [held, setHeld] = useState<{ file: File; seconds: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null);
  function send(file: File, seconds: number, source: Source = 'recorder') {
    const form = new FormData();
    form.set('file', file);
    form.set('durationSeconds', String(Math.min(Math.round(seconds), recorderLimits.maxSeconds)));
    if (committeeId) form.set('committeeId', committeeId);
    setHeld({ file, seconds });
    setOffline(false);
    setRefusal(null);
    setCaptureId(null);
    opened();
    create.mutate(form, {
      onSuccess: (created) => {
        setHeld(null);
        setCaptureId(created.data.id);
      },
      onError: (error) => {
        if (!(error instanceof ApiError)) return setOffline(true);
        const refused = refusalOf(error);
        setRefusal(refused);
        if (refused && source === 'sheet') return closed('sheet');
        if (refused) return toasts.add({ title: t(refused), priority: 'high' });
        toasts.add({ title: error.message });
        closed('recorder');
      },
    });
  }
  const reset = () => {
    setCaptureId(null);
    setHeld(null);
    setOffline(false);
    setRefusal(null);
  };
  // S8: just before 15:00 the hook stops by itself and the recording is kept, with a toast to say so.
  const finish = (recording: Recording) => {
    if (recording.seconds >= recorderLimits.stopSeconds) toasts.add({ title: t('limitReached') });
    send(recordingFile(recording, t('fileName')), recording.seconds);
  };
  const uploading = create.isPending;
  return {
    send,
    finish,
    held,
    offline,
    refusal,
    captureId,
    uploading,
    reset,
    committeeId,
    setCommitteeId,
  };
}
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
// CAPTURES-B01: the one recorder of the shell. A control starts it (`startCapture`); Stop or an
// upload sends the audio; the panel then follows the capture until the recorder dismisses it.
// The shell mounts it only while recording is on (CAPTURES-B14), and the chord only with `keys`.
export function CaptureHost({ keys }: { keys: ShortcutKeys }) {
  const placement = usePlacement();
  const pageCommittee = usePageCommittee();
  const [phase, setPhase] = useState<Phase>('idle');
  const upload = useSend(
    () => setPhase('after'),
    (source) => setPhase(source === 'sheet' ? 'recording' : 'idle'),
  );
  const committee = useCommitteeName(upload.committeeId) ?? null;
  const recorder = useVoiceRecorder(upload.finish);
  function begin() {
    localStorage.setItem(introKey, '1');
    upload.reset();
    upload.setCommitteeId(pageCommittee);
    setPhase('recording');
    void recorder.start();
  }
  useLauncher(
    () => phase === 'idle' && (localStorage.getItem(introKey) ? begin() : setPhase('intro')),
  );
  const done = () => {
    setPhase('idle');
    upload.reset();
  };
  const discard = useRefocus(() => {
    recorder.cancel();
    done();
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
          pick={(file) => upload.send(file, 0, 'sheet')}
          refusal={refused ? upload.refusal : null}
        />
      )}
      {recording && (
        <CaptureRecorder.Root
          recorder={recorder}
          placement={placement}
          committee={committee}
          clearCommittee={() => upload.setCommitteeId(null)}
          discard={discard}
        >
          <CaptureRecorder.Surface />
          <CaptureRecorder.Actions />
        </CaptureRecorder.Root>
      )}
      {phase === 'after' && <After placement={placement} upload={upload} done={done} />}
    </>
  );
}
function After({
  placement,
  upload,
  done,
}: {
  placement: Placement;
  upload: ReturnType<typeof useSend>;
  done: () => void;
}) {
  const capture = useCapture(upload.captureId).data?.data;
  const { held } = upload;
  return (
    <CaptureProcessing
      placement={placement}
      stage={stageOf(upload.uploading, upload.offline, capture, upload.refusal)}
      capture={capture}
      refusal={upload.refusal}
      seconds={held?.seconds ?? capture?.durationSeconds ?? 0}
      done={done}
      retry={() => held && upload.send(held.file, held.seconds)}
    />
  );
}
