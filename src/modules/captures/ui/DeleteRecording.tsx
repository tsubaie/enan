'use client';
import { createContext, use, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Ellipsis, Trash2 } from 'lucide-react';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/primitives/popover';
import type { CaptureGroup as Group } from '../schema/validation';
import { useReviewMutations } from './capture-queries';
import { focusAfterDeleting } from './review-action';
import { useInbox } from './inbox-state';
import { useDeletedToast } from './review-toast';
// S17: delete at once, then Undo on the receipt; no confirm dialog. Focus moves to the next group,
// else the inbox heading; after Undo, to the restored group's first action. A failed delete leaves
// the group where it was and says so.
function useDeleteRecording(group: Group) {
  const mutations = useReviewMutations();
  const toast = useDeletedToast();
  const { inbox } = useInbox();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function remove() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const focusNext = focusAfterDeleting(group.id);
    try {
      const { opId } = await mutations.removeCapture(group.id);
      toast.deleted(group, opId, inbox);
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
// A group's capture-level actions sit behind «⋯» in its header, never beside Approve. Escape
// closes the menu and returns focus to the trigger (the popover's own behaviour). The delete's
// state lives here, not in the item, so it outlives the menu closing on the press.
type GroupMenuState = { close: () => void; deletion: ReturnType<typeof useDeleteRecording> };
const GroupMenuContext = createContext<GroupMenuState | null>(null);
function GroupMenuRoot({ group, children }: { group: Group; children: ReactNode }) {
  const t = useTranslations('captures');
  const [open, setOpen] = useState(false);
  const deletion = useDeleteRecording(group);
  return (
    <GroupMenuContext value={{ close: () => setOpen(false), deletion }}>
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
        {/* Opaque like the other capture surfaces: the glass let the page's text read through. */}
        <PopoverContent
          align="end"
          surface="elevated"
          className="w-auto p-1.5"
          data-testid="capture-menu"
        >
          {children}
        </PopoverContent>
      </Popover>
    </GroupMenuContext>
  );
}
function GroupMenuDelete() {
  const menu = use(GroupMenuContext);
  if (!menu) throw new Error('GroupMenu.Delete is outside GroupMenu.Root');
  return (
    <DeleteRecordingButton
      className="w-full justify-start"
      disabled={menu.deletion.busy}
      onClick={() => {
        menu.close();
        void menu.deletion.remove();
      }}
    />
  );
}
const GroupMenu = { Root: GroupMenuRoot, Delete: GroupMenuDelete };
// S15: a ready group, one whose drafts were all discarded included.
export function ReadyGroupMenu({ group }: { group: Group }) {
  return (
    <GroupMenu.Root group={group}>
      <GroupMenu.Delete />
    </GroupMenu.Root>
  );
}
// S15: a group still transcribing or preparing drafts. Its job's result is fenced off once it is
// deleted, and Undo after that job has ended brings it back as failed (interrupted), with Retry.
export function ProcessingGroupMenu({ group }: { group: Group }) {
  return (
    <GroupMenu.Root group={group}>
      <GroupMenu.Delete />
    </GroupMenu.Root>
  );
}
