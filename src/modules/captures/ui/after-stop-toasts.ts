'use client';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/core/http/client';
import { routes } from '@/core/routes';
import { useToastManager } from '@/ui/primitives/toast';
import { recorderLimits } from '@/modules/notes/ui';
import { useCreateCapture } from './capture-queries';
import { dropItem, moveItem, outboxItem, putItem, type OutboxItem } from './outbox';
import { refusalOf, type Refusal } from './upload-refusal';
// CAPTURES-B20: after Stop the recorder closes and the reader stays where they were; one toast per
// recording says what became of it, updated in place (its id is the recording's local id):
// uploading → processing (the first one on this device: the first-run toast) → gone,
// uploading → saved but unavailable (a warning that stays) → gone,
// uploading → failed (held for Retry or Discard) or refused (Discard only).
// The toasts are fired from the upload's own callbacks, never from an effect, and never move focus.
type Manager = ReturnType<typeof useToastManager>;
type Toast = Parameters<Manager['add']>[0];
type Words = ReturnType<typeof useTranslations<'captures'>>;
// The first-run flag is versioned and read and written in the event path, never in render; it is
// set only once the first-run toast is actually shown (Q11).
const firstRunKey = 'enan.captures.first-run:v1';
function firstRun() {
  try {
    if (localStorage.getItem(firstRunKey) === '1') return false;
    localStorage.setItem(firstRunKey, '1');
    return true;
  } catch {
    // A browser that refuses storage is treated as having seen it, rather than every time.
    return false;
  }
}
// About five seconds for the routine line; the primitive holds it while hovered or focused.
const processingShown = 5000;
// Every outcome names each field, so nothing of the toast it replaces in place is left behind.
const blank = { description: undefined, actionProps: undefined, data: {} };
const view = (label: string) => ({ href: routes.captures(), label });
const uploading = (t: Words): Toast => ({
  ...blank,
  title: t('uploadingTitle'),
  priority: 'low',
  timeout: 0,
  data: { progress: t('uploadingTitle') },
});
// The server has the recording. `notice` marks the two that stay until they are closed.
function landed(t: Words, status: string): Toast & { notice: boolean } {
  if (status === 'needs_transcript')
    return {
      ...blank,
      notice: true,
      title: t('unavailable'),
      priority: 'low',
      timeout: 0,
      data: { tone: 'warning', view: view(t('view')) },
    };
  if (firstRun())
    return {
      ...blank,
      notice: true,
      title: t('firstRunTitle'),
      description: `${t('firstRunBody')}\n${t('education')}`,
      priority: 'low',
      timeout: 0,
      data: { view: view(t('howItWorks')) },
    };
  return {
    ...blank,
    notice: false,
    title: t('processingTitle'),
    priority: 'low',
    timeout: processingShown,
    data: { view: view(t('view')) },
  };
}
// Q18: a refusal cannot succeed on Retry (too large, too long, recording off): Discard only.
// Anything else (offline, a server error, a full queue) is held in this tab for Retry or Discard.
function held(t: Words, refusal: Refusal | null, retry: () => void, discard: () => void): Toast {
  const secondary = { label: t('discard'), onClick: discard };
  return refusal
    ? { ...blank, title: t(refusal), priority: 'high', timeout: 0, data: { secondary } }
    : {
        title: t('uploadFailedTitle'),
        description: t('uploadFailedBody'),
        priority: 'high',
        timeout: 0,
        actionProps: { children: t('retry'), onClick: retry },
        data: { secondary },
      };
}
function formOf(item: OutboxItem) {
  const form = new FormData();
  form.set('file', item.file);
  form.set(
    'durationSeconds',
    String(Math.min(Math.round(item.seconds), recorderLimits.maxSeconds)),
  );
  if (item.committeeId) form.set('committeeId', item.committeeId);
  return form;
}
// At most one persistent informational toast (first-run or unavailable) at a time: a newer one
// closes the older, the way a newer delete replaces its receipt. Held recordings each keep theirs,
// and nothing here ever closes another module's toast (the delete receipt included).
let lastNotice: string | null = null;
let recorded = 0;
export function useAfterStop() {
  const t = useTranslations('captures');
  const manager = useToastManager();
  const create = useCreateCapture();
  function discard(localId: string) {
    dropItem(localId);
    manager.close(localId);
  }
  function settle(localId: string, status: string) {
    dropItem(localId);
    const { notice, ...toast } = landed(t, status);
    if (notice && lastNotice && lastNotice !== localId) manager.close(lastNotice);
    if (notice) lastNotice = localId;
    manager.add({ ...toast, id: localId });
  }
  // `refused` takes a refusal instead of the toast: the S3 sheet says it in place (CAPTURES-B12).
  function upload(localId: string, refused?: (refusal: Refusal) => void) {
    const item = outboxItem(localId);
    if (!item) return;
    moveItem(localId, 'uploading');
    manager.add({ ...uploading(t), id: localId });
    create.mutateAsync(formOf(item)).then(
      (created) => settle(localId, created.data.status),
      (error: unknown) => {
        const refusal = error instanceof ApiError ? refusalOf(error) : null;
        if (refusal && refused) {
          discard(localId);
          return refused(refusal);
        }
        moveItem(localId, refusal ? 'refused' : 'failed');
        const toast = held(
          t,
          refusal,
          () => upload(localId),
          () => discard(localId),
        );
        manager.add({ ...toast, id: localId });
      },
    );
  }
  return {
    record(
      file: File,
      seconds: number,
      committeeId: string | null,
      refused?: (r: Refusal) => void,
    ) {
      recorded += 1;
      const localId = `recording-${recorded}`;
      putItem({ localId, file, seconds, committeeId, state: 'uploading' });
      upload(localId, refused);
    },
  };
}
