'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { Button } from '@/ui/primitives/button';
import { Segmented } from '@/ui/primitives/segmented';
import { useToastManager } from '@/ui/primitives/toast';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { Markdown } from '@/ui/markdown/Markdown';
import { useUndoToast } from '@/ui/layout/toast/use-undo-toast';
import { type AiReview } from '@/ui/ai/queries';
import { RefinementOutput } from '../schema/validation';
type Result = z.infer<typeof RefinementOutput>;
export type ReviewView = 'rewrite' | 'original' | 'both';
export type Selection = ReturnType<typeof useReviewSelection>;
// NOTES-B18: what the reader keeps. The selection is reset from the proposal when review is
// entered; Keep writes the field's draft, the ticked tags and the ticked tasks with their reviewed
// titles; Discard drops the proposal and the toast offers Undo, which restores it. One selection
// feeds the header, the card and the footer, which sit in different parts of the expanded view.
type Picked = { tasks: number[]; tags: number[]; titles: string[] };
export function useReviewSelection(review: AiReview, onDone: () => void) {
  const t = useTranslations('ai');
  const toast = useUndoToast();
  const toasts = useToastManager();
  const [picked, setPicked] = useState<Picked>({ tasks: [], tags: [], titles: [] });
  const busy = review.apply.isPending || review.discard.isPending || review.pending;
  const jobId = review.job?.id ?? '';
  const keep = (result: Result, draft: string) =>
    review.apply.mutate(
      {
        jobId,
        acceptContent: true,
        ...(draft !== result.refined_content ? { content: draft } : {}),
        taskIndexes: picked.tasks,
        tagIndexes: picked.tags,
        taskTitles: picked.tasks.map((index) => ({ index, title: picked.titles[index] ?? '' })),
      },
      {
        onSuccess: () => {
          onDone();
          toasts.add({ title: t('kept') });
        },
      },
    );
  const discard = () =>
    review.discard.mutate(undefined, {
      onSuccess: () => {
        onDone();
        toast({
          message: t('discarded'),
          undo: () => review.restore.mutateAsync(jobId).then(() => undefined),
        });
      },
    });
  return {
    ...picked,
    busy,
    invalidTitles: picked.tasks.some((index) => !picked.titles[index]?.trim()),
    keep,
    discard,
    reset: (result: Result) =>
      setPicked({
        tasks: result.suggested_tasks.map((_, index) => index),
        tags: result.suggested_tags.map((_, index) => index),
        titles: result.suggested_tasks.map((task) => task.title),
      }),
    setTasks: (tasks: number[]) => setPicked((current) => ({ ...current, tasks })),
    setTags: (tags: number[]) => setPicked((current) => ({ ...current, tags })),
    setTitle: (index: number, title: string) =>
      setPicked((current) => ({
        ...current,
        titles: current.titles.map((value, position) => (position === index ? title : value)),
      })),
  };
}
// The header: how to look at the proposal, a word only when it can no longer be kept, and what
// changed in one line that opens when the model wrote more.
export function ReviewHeader({
  review,
  result,
  view,
  setView,
}: {
  review: AiReview;
  result: Result;
  view: ReviewView;
  setView: (view: ReviewView) => void;
}) {
  const t = useTranslations('ai');
  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewSwitch view={view} setView={setView} />
        {review.stale && (
          <p role="status" className="text-sm text-text-muted">
            {t('noteChanged')}
          </p>
        )}
      </div>
      {result.summary_of_changes && <WhatChanged summary={result.summary_of_changes} />}
    </div>
  );
}
// Rewrite, Original, or both side by side (from 1024 px): the product's segmented group.
function ViewSwitch({ view, setView }: { view: ReviewView; setView: (view: ReviewView) => void }) {
  const t = useTranslations('ai');
  const views: { id: ReviewView; label: string; wide?: boolean }[] = [
    { id: 'rewrite', label: t('viewRewrite') },
    { id: 'original', label: t('viewOriginal') },
    { id: 'both', label: t('viewSideBySide'), wide: true },
  ];
  return (
    <Segmented
      label={t('reviewView')}
      value={view}
      onChange={setView}
      segments={views.map((item) => ({
        value: item.id,
        label: item.label,
        ...(item.wide ? { className: 'hidden lg:inline-flex' } : {}),
      }))}
    />
  );
}
// The model's account of what it changed, in full: it is a sentence or two, so a toggle to reveal
// the rest hid nothing on most notes and read as a control that did nothing.
function WhatChanged({ summary }: { summary: string }) {
  const t = useTranslations('ai');
  return (
    <p dir="auto" className="text-sm font-light text-text-muted">
      <span className="me-1 font-medium text-text">{t('whatChanged')}</span>
      {summary}
    </p>
  );
}
// The original, read-only, where the mode asks for it.
export function ReviewOriginal({ content }: { content: string }) {
  const t = useTranslations('ai');
  return (
    <section aria-label={t('viewOriginal')} className="grid gap-2">
      {/* The same label row the field has, so the two texts start level. */}
      <h3 className="flex min-h-8 items-center text-sm! font-medium">{t('viewOriginal')}</h3>
      <div className="rounded-xl border bg-bg/50 px-5 py-4">
        <Markdown content={content} />
      </div>
    </section>
  );
}
// The footer: Discard at the start, the one decision at the end, its name saying what it does.
export function ReviewActions({
  review,
  result,
  draft,
  selection,
}: {
  review: AiReview;
  result: Result;
  draft: string;
  selection: Selection;
}) {
  const t = useTranslations('ai');
  const count = selection.tasks.length;
  return (
    // Apple's sheet: status at the leading side, the actions together at the trailing end with the
    // primary one last, both capsules.
    <div className="flex flex-wrap items-center gap-2">
      {selection.busy && (
        <p role="status" className="text-sm text-text-muted">
          {review.apply.isPending ? t('applying') : t('working')}
        </p>
      )}
      {review.error && <ErrorPanel error={review.error} />}
      <span className="ms-auto" />
      <Button
        variant="secondary"
        className="pointer-coarse:h-11"
        disabled={selection.busy}
        onClick={selection.discard}
      >
        {t('discardRewrite')}
      </Button>
      {review.stale ? (
        review.enabled && (
          <Button
            className="pointer-coarse:h-11"
            disabled={selection.busy}
            onClick={() => review.start.mutate()}
          >
            {t('regenerate')}
          </Button>
        )
      ) : (
        <Button
          className="tabular-nums pointer-coarse:h-11"
          disabled={selection.busy || (count > 0 && selection.invalidTitles)}
          onClick={() => selection.keep(result, draft)}
        >
          {count > 0 ? t('keepAndCreate', { count }) : t('keepRewrite')}
        </Button>
      )}
    </div>
  );
}
