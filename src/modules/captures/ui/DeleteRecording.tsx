'use client';
import { useRef, useState, type ComponentProps } from 'react';
import { useTranslations } from 'next-intl';
import { Ellipsis, Trash2 } from 'lucide-react';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/primitives/popover';
import type { CaptureGroup as Group } from '../schema/validation';
import { useReviewMutations } from './capture-queries';
import { focusAfterDeleting, listedGroup } from './review-action';
import { useDeletedToast } from './review-toast';
// S17: delete at once, then Undo on the receipt; no confirm dialog. Focus moves to the next group,
// else the inbox heading; after Undo, to the restored group's first action. A failed delete leaves
// the group where it was and says so.
function useDeleteRecording(group: Group) {
  const mutations = useReviewMutations();
  const toast = useDeletedToast();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function remove() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const focusNext = focusAfterDeleting(group.id);
    try {
      const { opId } = await mutations.removeCapture(group.id);
      toast.deleted(group, opId, () => listedGroup(group.id)?.querySelector('button')?.focus());
      focusNext();
    } catch {
      running.current = false;
      setBusy(false);
      toast.failed();
    }
  }
  return { busy, remove };
}
// Destructive, but quiet: ghost, the danger text and a trash icon, always with its words.
function DeleteRecordingButton({ className, ...props }: ComponentProps<typeof Button>) {
  const t = useTranslations('captures');
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('text-danger hover:text-danger pointer-coarse:min-h-11', className)}
      {...props}
    >
      <Trash2 aria-hidden />
      {t('deleteRecording')}
    </Button>
  );
}
// S17, S29: the recover card's Delete recording, after Retry and Type the transcript.
export function RecoverDeleteButton({ group }: { group: Group }) {
  const deletion = useDeleteRecording(group);
  return <DeleteRecordingButton disabled={deletion.busy} onClick={() => void deletion.remove()} />;
}
// A ready group's capture-level actions sit behind «⋯» in its header, never beside Approve.
// Escape closes the menu and returns focus to the trigger (the popover's own behaviour).
export function ReadyGroupMenu({ group }: { group: Group }) {
  const t = useTranslations('captures');
  const [open, setOpen] = useState(false);
  const deletion = useDeleteRecording(group);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="ms-auto shrink-0 pointer-coarse:size-11"
            aria-label={t('moreActions')}
          />
        }
      >
        <Ellipsis aria-hidden />
      </PopoverTrigger>
      {/* Opaque like the other capture surfaces; `!` beats the night glass rule on popover-content. */}
      <PopoverContent
        align="end"
        className="w-auto bg-elevated! bg-none! p-1.5"
        data-testid="capture-menu"
      >
        <DeleteRecordingButton
          className="w-full justify-start"
          disabled={deletion.busy}
          onClick={() => {
            setOpen(false);
            void deletion.remove();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
