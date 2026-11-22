'use client';
import { useTranslations } from 'next-intl';
import { Check, LoaderCircle } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/cn';
import { useReviewMutations } from './capture-queries';
import { useApprovedMessage } from './suggestion-text';
import { useReviewToast } from './review-toast';
import { useCard } from './suggestion-card-context';
import { blockers } from '../schema/validation';
const Spinner = () => <LoaderCircle aria-hidden className="motion-safe:animate-spin" />;
// Approve with a required field unsettled stays focusable and says why (S22); while it is sent it
// is busy and a second click does nothing.
export function ApproveButton({ reason }: { reason: string }) {
  const t = useTranslations('captures');
  const { missing, busy, leave } = useCard();
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
        leave('approve', async (saved) => {
          // The save left a required field unsettled; the reason now shows instead.
          if (blockers(saved).length) return;
          const approval = (await mutations.approve(saved)).data;
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
  const { busy, leave } = useCard();
  const mutations = useReviewMutations();
  const toast = useReviewToast();
  return (
    <Button
      variant="ghost"
      className="ms-auto text-danger"
      aria-busy={busy === 'discard' || undefined}
      onClick={() =>
        leave('discard', async (saved) => {
          await mutations.discard(saved);
          toast.discarded(saved.id);
        })
      }
    >
      {busy === 'discard' && <Spinner />}
      {t('discard')}
    </Button>
  );
}
