'use client';
import { useTranslations } from 'next-intl';
import { Check, LoaderCircle } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import { useReviewMutations } from './capture-queries';
import { useApprovedMessage } from './suggestion-text';
import { useReviewToast } from './review-toast';
import { useCard } from './suggestion-card-context';
const Spinner = () => <LoaderCircle aria-hidden className="motion-safe:animate-spin" />;
// Approve with a required field unsettled stays focusable and says why (S22); while it is sent it
// is busy and a second click does nothing.
export function ApproveButton({ reason }: { reason: string }) {
  const t = useTranslations('captures');
  const { draft, missing, busy, leave } = useCard();
  const mutations = useReviewMutations();
  const toast = useReviewToast();
  const message = useApprovedMessage();
  const blocked = missing.length > 0;
  return (
    <Button
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? reason : undefined}
      aria-busy={busy === 'approve' || undefined}
      className={cn(blocked && 'opacity-60')}
      onClick={() => {
        if (blocked) return;
        leave('approve', async () => {
          const approval = (await mutations.approve(draft)).data;
          toast.approved(message(approval), [approval]);
        });
      }}
    >
      {busy === 'approve' ? <Spinner /> : <Check aria-hidden />}
      {t('approve')}
    </Button>
  );
}
// Discard has no confirm; its toast offers Undo (S25, S28).
export function DiscardButton() {
  const t = useTranslations('captures');
  const { draft, busy, leave } = useCard();
  const mutations = useReviewMutations();
  const toast = useReviewToast();
  return (
    <Button
      variant="ghost"
      className="ms-auto text-danger"
      aria-busy={busy === 'discard' || undefined}
      onClick={() =>
        leave('discard', async () => {
          await mutations.discard(draft);
          toast.discarded(draft.id);
        })
      }
    >
      {busy === 'discard' && <Spinner />}
      {t('discard')}
    </Button>
  );
}
