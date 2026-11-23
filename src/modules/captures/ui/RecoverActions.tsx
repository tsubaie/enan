'use client';
import { useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Hourglass, Info, PenLine, RefreshCw } from 'lucide-react';
import { routes } from '@/core/routes';
import { Button } from '@/ui/primitives/button';
import { Textarea } from '@/ui/primitives/textarea';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import type { CaptureGroup as Group } from '../schema/validation';
import { useRetryCapture, useReviewMutations } from './capture-queries';
import { RecoverDeleteButton } from './DeleteRecording';
import { useInbox } from './inbox-state';
// CAPTURES-B22: the chip that names a recording waiting for transcription.
export function WaitingChip() {
  const t = useTranslations('captures');
  return (
    <p className="inline-flex items-center gap-1.5 justify-self-start rounded-full border border-warning/40 bg-warning-soft px-2.5 py-0.5 text-sm font-medium text-warning">
      <Hourglass aria-hidden className="size-4" />
      {t('waitingTranscription')}
    </p>
  );
}
// CAPTURES-B22: why it waits. An administrator, when transcription is switched off, is told where
// to turn it on; everyone else (and an administrator while it is only unavailable) hears that it
// is not available here now.
export function WaitingReason({ id }: { id: string }) {
  const t = useTranslations('captures');
  const { transcription, reader } = useInbox();
  return (
    <p id={id} className="flex items-start gap-2 text-sm font-medium text-warning">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      {transcription === 'off' && reader === 'admin' ? (
        <span>
          {t('transcriptionOffAdmin')}{' '}
          <Link href={routes.admin('ai')} className="underline underline-offset-4">
            {t('openAiSettings')}
          </Link>
        </span>
      ) : (
        <span>{t('transcriptionUnavailable')}</span>
      )}
    </p>
  );
}
// S17, S29: Retry, Type the transcript, then Delete recording last, wrapping in reading order.
// `blockedBy` is the id of the reason both first actions wait on (CAPTURES-B22: transcription is
// switched off): they stay focusable, say why, and do nothing when pressed. Delete still works.
// `saved` hears the revision a typed transcript was saved onto, once the save settles either way,
// so the group can move focus when it is listed anew (CAPTURES-B25).
type Saved = (typedOn: number) => void;
const blockedProps = (reason: string | null) => ({
  'aria-disabled': reason ? true : undefined,
  'aria-describedby': reason ?? undefined,
  className:
    'aria-disabled:cursor-not-allowed aria-disabled:bg-muted aria-disabled:text-text-muted',
});
type RecoverProps = { group: Group; blockedBy: string | null; saved: Saved };
export function RecoverActions({ group, blockedBy, saved }: RecoverProps) {
  const t = useTranslations('captures');
  const retry = useRetryCapture();
  const [typing, setTyping] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const blocked = blockedProps(blockedBy);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          {...blocked}
          data-recover="retry"
          disabled={retry.isPending}
          onClick={() => {
            if (!blockedBy) retry.mutate(group);
          }}
        >
          <RefreshCw aria-hidden />
          {t('retry')}
        </Button>
        <Button
          ref={toggle}
          variant="outline"
          size="sm"
          {...blocked}
          aria-expanded={typing}
          onClick={() => {
            if (blockedBy) return;
            // The field is drawn before focus moves into it, in this same press.
            flushSync(() => setTyping(!typing));
            if (!typing) field.current?.focus();
          }}
        >
          <PenLine aria-hidden />
          {t('typeTranscript')}
        </Button>
        <RecoverDeleteButton group={group} />
      </div>
      {typing && (
        <TypeTranscript
          group={group}
          field={field}
          saved={saved}
          done={() => setTyping(false)}
          cancel={() => {
            setTyping(false);
            toggle.current?.focus();
          }}
        />
      )}
      {retry.error && <ErrorPanel error={retry.error} />}
    </>
  );
}
// S17 «كتابة النص»: a typed transcript replaces what the recording held and is interpreted anew.
// Cancel closes it and puts focus back on Type the transcript. While the save is sent its controls
// are disabled, so it cannot go twice, and a polite status says so (CAPTURES-B25).
type Field = RefObject<HTMLTextAreaElement | null>;
type TypeProps = { group: Group; field: Field; saved: Saved; done: () => void; cancel: () => void };
function TypeTranscript({ group, field, saved, done, cancel }: TypeProps) {
  const t = useTranslations('captures');
  const mutations = useReviewMutations();
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="grid gap-2 border-t pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        const transcript = String(new FormData(event.currentTarget).get('transcript') ?? '').trim();
        if (!transcript) return;
        setSaving(true);
        const typedOn = group.revision;
        mutations.typeTranscript(group.id, transcript).then(
          () => {
            done();
            saved(typedOn);
          },
          (failure: unknown) => {
            setSaving(false);
            setError(failure instanceof Error ? failure : null);
            // A refusal can still have kept the words (CAPTURES-B23), and failed the capture.
            saved(typedOn);
          },
        );
      }}
    >
      <fieldset disabled={saving} className="grid min-w-0 gap-2">
        <TranscriptField group={group} field={field} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">
            {t('saveTranscript')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={cancel}>
            {t('cancel')}
          </Button>
          <p role="status" className="text-sm text-text-muted">
            {saving ? t('savingTranscript') : null}
          </p>
        </div>
      </fieldset>
      {error && <ErrorPanel error={error} />}
    </form>
  );
}
function TranscriptField({ group, field }: { group: Group; field: Field }) {
  const t = useTranslations('captures');
  const hint = `capture-${group.id}-hint`;
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={`capture-${group.id}-transcript`} className="font-medium">
        {t('transcriptLabel')}
      </label>
      <p id={hint} className="text-text-muted">
        {t('transcriptHint')}
      </p>
      <Textarea
        ref={field}
        id={`capture-${group.id}-transcript`}
        name="transcript"
        dir="auto"
        rows={4}
        required
        aria-describedby={hint}
        defaultValue={group.transcript ?? ''}
      />
    </div>
  );
}
