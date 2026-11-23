'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useRelativeTime } from '@/ui/format';
import { clock } from '@/modules/notes/ui';
import type { CaptureGroup as Group } from '../schema/validation';
import { CaptureListen } from './CaptureListen';
import { MergeSheet } from './MergeSheet';
import { SuggestionCardView, type Layout } from './SuggestionCard';
import { ProcessingGroupMenu, ReadyGroupMenu } from './DeleteRecording';
import { RecoverActions, WaitingChip, WaitingReason } from './RecoverActions';
import { focusWasLost } from './focus';
import { takePendingFocus, useFocusPending, useInbox } from './inbox-state';
const working = ['queued', 'transcribing', 'interpreting'];
const failures: Record<string, 'failedNoSpeech' | 'failedTimeout' | 'failedInterrupted'> = {
  no_speech: 'failedNoSpeech',
  timeout: 'failedTimeout',
  // CAPTURES-B13: restored after the job it waited on ended while it was deleted.
  interrupted: 'failedInterrupted',
};
// S17: why a recording failed, in the reader's words.
const failure = (code: string | null) =>
  (code && Object.hasOwn(failures, code) && failures[code]) || 'failedOther';
// S15, S17: one recording: when it was made, how long it is, the whole clip, its processing state
// and its drafts still waiting. Header parts are split by a 1px rule, never a dot.
export function CaptureGroup({ group, layout }: { group: Group; layout: Layout }) {
  const pending = group.suggestions.filter((draft) => draft.status === 'pending');
  const section = useRef<HTMLElement>(null);
  const focusPending = useFocusPending(group.id);
  // S17 Undo: the restored group, once it renders, takes the focus Undo left for it: its first
  // action. A layout effect, so it lands in the same commit that lists the group. The id is cleared
  // either way; focus moves only if it was lost meanwhile, not if the reader moved it elsewhere.
  useLayoutEffect(() => {
    if (focusPending && takePendingFocus(group.id) && focusWasLost())
      section.current?.querySelector<HTMLElement>('button')?.focus();
  }, [focusPending, group.id]);
  // CAPTURES-B22: a recording waiting for transcription is one warning-edged card, chip first.
  const waiting = group.status === 'needs_transcript';
  return (
    <CaptureListen.Provider group={group}>
      <section
        ref={section}
        aria-labelledby={`capture-${group.id}`}
        className={
          waiting ? 'grid gap-3 rounded-xl border border-warning bg-elevated p-4' : 'grid gap-3'
        }
        data-testid="capture-group"
        data-capture={group.id}
      >
        {waiting ? <WaitingChip /> : null}
        <Header group={group} drafts={pending.length}>
          {group.status === 'ready' && <ReadyGroupMenu group={group} />}
          {working.includes(group.status) && <ProcessingGroupMenu group={group} />}
        </Header>
        {pending.length > 1 && (
          <div className="flex items-center justify-end gap-2">
            <MergeSheet group={group} drafts={pending} />
          </div>
        )}
        <CaptureListen.FullTranscript text={group.transcript} />
        <State group={group} />
        {pending.map((draft) => (
          <SuggestionCardView key={draft.id} draft={draft} group={group} layout={layout} />
        ))}
      </section>
    </CaptureListen.Provider>
  );
}
function Divider() {
  return <span aria-hidden className="h-3.5 w-px bg-border" />;
}
// `children` are the header's trailing actions (a ready group's More actions).
function Header({
  group,
  drafts,
  children,
}: {
  group: Group;
  drafts: number;
  children?: ReactNode;
}) {
  const t = useTranslations('captures');
  const format = useFormatter();
  const relative = useRelativeTime();
  const time = format.dateTime(new Date(group.createdAt), { hour: 'numeric', minute: '2-digit' });
  return (
    <header className="flex items-center gap-3">
      <CaptureListen.PlayButton />
      <div className="grid min-w-0 gap-0.5">
        <h3
          id={`capture-${group.id}`}
          tabIndex={-1}
          className="flex flex-wrap items-center gap-2 font-medium"
        >
          {drafts ? (
            <>
              <span>{t('groupTitle', { time })}</span>
              <Divider />
              <span>{t('draftCount', { count: drafts })}</span>
            </>
          ) : (
            <span>{t('recordingTitle', { time })}</span>
          )}
        </h3>
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <time dateTime={group.createdAt}>{relative(group.createdAt)}</time>
          <Divider />
          {/* The clock does not mirror in RTL. */}
          <span dir="ltr" className="tabular-nums">
            {clock(group.durationSeconds)}
          </span>
        </p>
      </div>
      {children}
    </header>
  );
}
// S15 processing lines, S17 failure and S29 waiting for transcription, each with Retry / Type the
// transcript / Delete recording.
function State({ group }: { group: Group }) {
  const t = useTranslations('captures');
  const { transcription } = useInbox();
  if (working.includes(group.status))
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
        <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
        {group.status === 'interpreting' ? t('preparingDrafts') : t('transcribing')}
      </p>
    );
  if (group.status === 'failed')
    return (
      <div className="grid gap-3 rounded-xl border border-danger bg-elevated p-4">
        <p className="flex items-center gap-2 font-medium text-danger">
          <CircleAlert aria-hidden className="size-4" />
          {t(failure(group.errorCode))}
        </p>
        <RecoverActions group={group} blockedBy={null} />
      </div>
    );
  if (group.status === 'needs_transcript') {
    const reason = `capture-${group.id}-reason`;
    return (
      <>
        <WaitingReason id={reason} />
        <RecoverActions group={group} blockedBy={transcription === 'off' ? reason : null} />
      </>
    );
  }
  return null;
}
