'use client';
import { useState } from 'react';
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
  const [error, setError] = useState<Error | null>(null);
  const choices = mergeable(drafts);
  const kept = choices.find((draft) => draft.id === keepId);
  const submit = () => {
    if (!kept) return;
    const mergeIds = choices
      .filter((draft) => draft.kind === kept.kind && draft.id !== kept.id)
      .map((draft) => draft.id);
    mutations.merge(group.id, kept.id, mergeIds).then(
      () => setOpen(false),
      (failure: unknown) => setError(failure instanceof Error ? failure : null),
    );
  };
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={choices.length ? undefined : true}
        title={choices.length ? undefined : t('mergeKindOnly')}
        onClick={() => {
          if (choices.length) setOpen(true);
        }}
      >
        <Merge aria-hidden />
        {t('merge')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t('mergeTitle')}</DialogTitle>
          <DialogDescription>{t('mergeBody')}</DialogDescription>
          <MergeChoices group={group} choices={choices} keepId={keepId} choose={setKeepId} />
          <p className="text-xs text-text-muted">{t('mergeKindOnly')}</p>
          {error && <ErrorPanel error={error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {c('cancel')}
            </Button>
            <Button disabled={!kept} onClick={submit}>
              <Merge aria-hidden />
              {t('merge')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
