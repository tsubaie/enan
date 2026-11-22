'use client';
import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Merge } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui/primitives/dialog';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { payloadFields, type CaptureGroup, type Suggestion } from '../schema/validation';
import { useReviewMutations } from './capture-queries';
import { listedDraft, useReviewAction } from './review-action';
// §9 decision 9: only drafts of one kind merge. The kinds that have a sibling to merge with.
export function mergeable(drafts: Suggestion[]) {
  return drafts.filter((draft) =>
    drafts.some((other) => other.id !== draft.id && other.kind === draft.kind),
  );
}
// S24: choose the draft that remains; the others of its kind become part of it.
export function MergeSheet({ group, drafts }: { group: CaptureGroup; drafts: Suggestion[] }) {
  const t = useTranslations('captures');
  const c = useTranslations('common');
  const mutations = useReviewMutations();
  const [open, setOpen] = useState(false);
  const [keepId, setKeepId] = useState<string | null>(null);
  const { error, busy, run } = useReviewAction<'merge'>();
  const merging = busy === 'merge';
  // After a merge the kept draft takes focus, not the Merge button that opened the sheet.
  const mergedId = useRef<string | null>(null);
  // The card itself: an element handed back to the dialog gets its first control focused.
  const restore = () => {
    const card = mergedId.current ? listedDraft(mergedId.current) : null;
    card?.focus();
    return !card;
  };
  const choices = mergeable(drafts);
  const kept = choices.find((draft) => draft.id === keepId);
  const submit = () => {
    if (!kept) return;
    const mergeIds = choices
      .filter((draft) => draft.kind === kept.kind && draft.id !== kept.id)
      .map((draft) => draft.id);
    run('merge', async () => {
      await mutations.merge(group.id, kept.id, mergeIds);
      mergedId.current = kept.id;
      setOpen(false); // with one draft left the sheet is gone and only this moves focus
      listedDraft(kept.id)?.focus();
    });
  };
  return (
    <>
      <MergeTrigger
        enabled={choices.length > 0}
        open={() => {
          mergedId.current = null;
          setOpen(true);
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent finalFocus={restore}>
          <DialogTitle>{t('mergeTitle')}</DialogTitle>
          <DialogDescription>{t('mergeBody')}</DialogDescription>
          <MergeChoices group={group} choices={choices} keepId={keepId} choose={setKeepId} />
          <p className="text-xs text-text-muted">{t('mergeKindOnly')}</p>
          {error && <ErrorPanel error={error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {c('cancel')}
            </Button>
            <Button disabled={!kept || merging} aria-busy={merging || undefined} onClick={submit}>
              <Merge aria-hidden />
              {t('merge')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
// Across kinds Merge stays focusable and says why beside it (§9 decision 9).
function MergeTrigger({ enabled, open }: { enabled: boolean; open: () => void }) {
  const t = useTranslations('captures');
  const hint = useId();
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={enabled ? undefined : true}
        aria-describedby={enabled ? undefined : hint}
        className="aria-disabled:cursor-not-allowed aria-disabled:border-dashed aria-disabled:text-text-muted"
        onClick={() => {
          if (enabled) open();
        }}
      >
        <Merge aria-hidden />
        {t('merge')}
      </Button>
      {!enabled && (
        <p id={hint} className="text-xs text-text-muted">
          {t('mergeKindOnly')}
        </p>
      )}
    </>
  );
}
function MergeChoices({
  group,
  choices,
  keepId,
  choose,
}: {
  group: CaptureGroup;
  choices: Suggestion[];
  keepId: string | null;
  choose: (draftId: string) => void;
}) {
  const t = useTranslations('captures');
  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{t('mergeTitle')}</legend>
      {choices.map((draft) => (
        <label
          key={draft.id}
          className="flex items-start gap-3 rounded-lg border p-3 has-checked:border-accent"
        >
          <input
            type="radio"
            name={`keep-${group.id}`}
            className="mt-1"
            checked={keepId === draft.id}
            onChange={() => choose(draft.id)}
          />
          <span className="grid">
            <span dir="auto" className="font-medium">
              {payloadFields(draft.payload).title?.toString()}
            </span>
            <span className="text-xs text-text-muted">{t(`kind_${draft.kind}`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
