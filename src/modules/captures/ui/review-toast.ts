'use client';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/core/http/client';
import { routes } from '@/core/routes';
import { useToastManager } from '@/ui/primitives/toast';
import type { Approval, CaptureGroup } from '../schema/validation';
import { useReviewMutations } from './capture-queries';
import { focusWasLost } from './focus';
import { focusWhenListed, inboxMounted, type InboxToken } from './inbox-state';
import { focusInboxHeading } from './review-action';
// S26–S28: five seconds, Undo, and View for a record just made. Undo is the server's call
// (CAPTURES-B11): a record edited since, or a minute gone, answers with the S27 sentence instead.
const shown = 5000;
// S17: a deleted recording's receipt stays ten seconds (held while hovered or focused); the line
// that says it is back, four.
const deletedShown = 10000;
const restoredShown = 4000;
// A new delete takes the previous delete's receipt away; that earlier delete stays done.
let lastDeleted: string | null = null;
export const liveHref = (live: Approval['live']) =>
  live.type === 'task' ? routes.tasks({ id: live.id }) : routes.notes({ id: live.id });
export function useReviewToast() {
  const t = useTranslations('captures');
  const c = useTranslations('common');
  const manager = useToastManager();
  const mutations = useReviewMutations();
  function undo(toastId: string, ids: string[], done: string) {
    manager.update(toastId, {
      timeout: 0,
      data: {},
      actionProps: { children: c('undo'), disabled: true },
    });
    mutations.undo(ids).then(
      () =>
        manager.update(toastId, {
          title: done,
          timeout: shown,
          actionProps: { children: undefined },
        }),
      (error: unknown) =>
        manager.update(toastId, {
          title:
            error instanceof ApiError && error.code === 'rule_violation'
              ? t('undoUnavailable')
              : c('undoFailed'),
          priority: 'high',
          timeout: 0,
          actionProps: { children: undefined },
        }),
    );
  }
  // A receipt with more to say (drafts left out) is said first, at high priority.
  function show(message: string, ids: string[], done: string, view?: string, more: string[] = []) {
    const toastId: string = manager.add({
      title: [message, ...more].join(' '),
      priority: more.length ? 'high' : 'low',
      timeout: more.length ? 15000 : shown,
      data: view ? { view: { href: view, label: t('view') } } : {},
      actionProps: { children: c('undo'), onClick: () => undo(toastId, ids, done) },
    });
  }
  return {
    approved: (message: string, approvals: Approval[], skipped: string[] = []) =>
      show(
        message,
        approvals.map((item) => item.suggestion.id),
        t('undone'),
        approvals.length === 1 && approvals[0] ? liveHref(approvals[0].live) : undefined,
        skipped,
      ),
    // Nothing was approved, so there is nothing to undo.
    notice: (message: string) => manager.add({ title: message, priority: 'high' }),
    discarded: (draftId: string) => show(t('discarded'), [draftId], t('restored')),
  };
}
// S17: the receipt for a deleted recording. Undo sends the delete's own op id back; once it is
// restored the group takes focus as it is listed again (`focusWhenListed`), and a restore that fails
// leaves focus on the inbox heading, never on the page.
export function useDeletedToast() {
  const t = useTranslations('captures');
  const c = useTranslations('common');
  const manager = useToastManager();
  const mutations = useReviewMutations();
  // `inbox` is the inbox the delete was made in: the focus moves only while it is still mounted.
  function restore(toastId: string, group: CaptureGroup, opId: string, inbox: InboxToken) {
    manager.update(toastId, { timeout: 0, actionProps: { children: c('undo'), disabled: true } });
    mutations.restoreCapture(group.id, opId).then(
      () => {
        manager.update(toastId, {
          title: t('recordingRestored'),
          timeout: restoredShown,
          actionProps: { children: undefined },
        });
        if (inboxMounted(inbox)) focusWhenListed(group.id, inbox);
      },
      () => {
        manager.update(toastId, {
          title: t('restoreFailed'),
          priority: 'high',
          timeout: 0,
          actionProps: { children: undefined },
        });
        if (inboxMounted(inbox) && focusWasLost()) focusInboxHeading();
      },
    );
  }
  return {
    deleted: (group: CaptureGroup, opId: string, inbox: InboxToken) => {
      if (lastDeleted) manager.close(lastDeleted);
      const approved = group.suggestions.some((draft) => draft.status === 'approved');
      const toastId: string = manager.add({
        title: approved ? t('recordingDeletedApproved') : t('recordingDeleted'),
        priority: 'low',
        timeout: deletedShown,
        data: {},
        actionProps: {
          children: c('undo'),
          onClick: () => restore(toastId, group, opId, inbox),
        },
      });
      lastDeleted = toastId;
    },
    // An alert that stays until it is dismissed: the recording is still there to act on again.
    failed: () => manager.add({ title: t('deleteFailed'), priority: 'high', timeout: 0 }),
  };
}
