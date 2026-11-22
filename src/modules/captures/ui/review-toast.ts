'use client';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/core/http/client';
import { routes } from '@/core/routes';
import { useToastManager } from '@/ui/primitives/toast';
import type { Approval } from '../schema/validation';
import { useReviewMutations } from './capture-queries';
// S26–S28: five seconds, Undo, and View for a record just made. Undo is the server's call
// (CAPTURES-B11): a record edited since, or a minute gone, answers with the S27 sentence instead.
const shown = 5000;
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
      timeout: shown,
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
