'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';
import { TextCursorInput, WandSparkles } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Textarea } from '@/ui/primitives/textarea';
import { Segmented } from '@/ui/primitives/segmented';
import { Markdown } from '@/ui/markdown/Markdown';
import { reviewReady } from '@/ui/ai/AiReviewStatus';
import type { AiReview } from '@/ui/ai/queries';
import { RefinementOutput, type NoteDetail, type NoteVoiceMemo } from '../schema/validation';
import { useNoteMutations } from './queries';
import { useVoiceMutations } from './voice-queries';
import { BriefActionItems } from './BriefActionItems';
export type Run = (action: () => Promise<object>) => void;
type Tab = 'brief' | 'transcript';
type Brief = z.infer<typeof RefinementOutput>;
// What goes into the note goes after what is there, never in its place (NOTES-B31).
const appended = (content: string, text: string) =>
  content.trim() ? `${content.trimEnd()}\n\n${text}` : text;
// The tab shown is the one the reader chose, or the brief once there is one: derived, not synced.
function useMemoReview(note: NoteDetail, memo: NoteVoiceMemo, review: AiReview, run: Run) {
  const notes = useNoteMutations();
  const voice = useVoiceMutations();
  const proposal = RefinementOutput.safeParse(review.job?.result?.output);
  const brief = reviewReady(review) && proposal.success && !review.pending ? proposal.data : null;
  const [tab, setTab] = useState<Tab | null>(null);
  const active: Tab = tab ?? (brief ? 'brief' : 'transcript');
  const text = active === 'brief' ? brief?.refined_content : memo.transcript;
  const inNote = (value: string | null | undefined) =>
    Boolean(value?.trim() && note.content.includes(value.trim()));
  return {
    brief,
    active,
    setTab,
    text,
    inserted: inNote(text),
    insert: () =>
      run(() =>
        active === 'brief' && brief
          ? notes.patch(
              note.id,
              note.revision,
              { content: appended(note.content, brief.refined_content) },
              crypto.randomUUID(),
            )
          : voice.transcribe(note.id, memo.id, { appendToNote: true }),
      ),
    refine: () =>
      run(() =>
        voice.transcribe(note.id, memo.id, {
          appendToNote: !inNote(memo.transcript),
          refine: true,
        }),
      ),
    save: (transcript: string) => run(() => voice.transcribe(note.id, memo.id, { transcript })),
  };
}
// NOTES-B31: the brief and the verbatim transcript as two tabs. Nothing reaches the note until
// Insert into Note is pressed; Refine with AI puts the transcript in first (when it is not there
// already) and asks for the note's refinement, which the brief tab then shows.
export function VoiceMemoReview({
  note,
  memo,
  review,
  run,
}: {
  note: NoteDetail;
  memo: NoteVoiceMemo;
  review: AiReview;
  run: Run;
}) {
  const t = useTranslations('notes');
  const state = useMemoReview(note, memo, review, run);
  return (
    <div className="grid gap-3 rounded-lg bg-surface-raised/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={t('voiceReview')}
          value={state.active}
          onChange={state.setTab}
          segments={[
            { value: 'brief', label: t('briefTab') },
            { value: 'transcript', label: t('transcriptTab') },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {review.enabled && memo.transcript && (
            <Button size="sm" variant="ghost" disabled={review.pending} onClick={state.refine}>
              <WandSparkles aria-hidden />
              {t('refineVoice')}
            </Button>
          )}
          <Button size="sm" disabled={!state.text || state.inserted} onClick={state.insert}>
            <TextCursorInput aria-hidden />
            {state.inserted ? t('insertedIntoNote') : t('insertIntoNote')}
          </Button>
        </div>
      </div>
      <ReviewBody
        tab={state.active}
        note={note}
        memo={memo}
        brief={state.brief}
        pending={review.pending}
        save={state.save}
      />
    </div>
  );
}
function ReviewBody({
  tab,
  note,
  memo,
  brief,
  pending,
  save,
}: {
  tab: Tab;
  note: NoteDetail;
  memo: NoteVoiceMemo;
  brief: Brief | null;
  pending: boolean;
  save: (transcript: string) => void;
}) {
  const t = useTranslations('notes');
  if (tab === 'transcript') return <TranscriptView memo={memo} save={save} />;
  if (pending)
    return (
      <p role="status" className="text-sm text-text-muted">
        {t('briefRefining')}
      </p>
    );
  if (!brief) return <p className="text-sm text-text-muted">{t('noBrief')}</p>;
  return (
    <div className="grid gap-3">
      <Markdown content={brief.refined_content} interactive={false} />
      <BriefActionItems note={note} tasks={brief.suggested_tasks} />
    </div>
  );
}
// The words as spoken, or, when none came with the audio, a place to paste or type them.
function TranscriptView({
  memo,
  save,
}: {
  memo: NoteVoiceMemo;
  save: (transcript: string) => void;
}) {
  const t = useTranslations('notes');
  if (memo.transcript)
    return (
      <p dir="auto" className="text-sm whitespace-pre-wrap">
        {memo.transcript}
      </p>
    );
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const transcript = String(new FormData(event.currentTarget).get('transcript') ?? '').trim();
        if (transcript) save(transcript);
      }}
    >
      <p className="text-sm text-text-muted">{t('noTranscript')}</p>
      <Textarea name="transcript" aria-label={t('transcriptTab')} maxLength={50000} dir="auto" />
      <Button type="submit" size="sm" variant="secondary" className="justify-self-start">
        {t('saveTranscript')}
      </Button>
    </form>
  );
}
