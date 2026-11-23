'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CheckCheck, Inbox, LoaderCircle, Mic } from 'lucide-react';
import { routes } from '@/core/routes';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { blockers, type CaptureGroup as Group } from '../schema/validation';
import { startCapture } from './capture-store';
import { useCaptures, useReviewMutations, type CaptureScope } from './capture-queries';
import { CaptureGroup } from './CaptureGroup';
import { InboxEducation } from './InboxEducation';
import type { Layout } from './SuggestionCard';
import { useApprovedMessage } from './suggestion-text';
import { useReviewToast } from './review-toast';
import { listedDraft, useReviewAction } from './review-action';
import {
  InboxContext,
  pendingFocusId,
  takePendingFocus,
  useInbox,
  usePendingFocus,
} from './inbox-state';
import { focusWasLost } from './focus';
import { focusInboxHeading } from './review-action';
const pendingOf = (groups: Group[]) =>
  groups.flatMap((group) => group.suggestions.filter((draft) => draft.status === 'pending'));
const readyOf = (groups: Group[]) => pendingOf(groups).filter((draft) => !blockers(draft).length);
// S14: the reader's recordings, newest first, each with its drafts. The page hands in what the
// server already read; the panel reads it here. `actions` sits beside Approve N ready (the
// panel's expand and close).
function Root({
  layout,
  scope = 'mine',
  initial,
  actions,
  children,
}: {
  layout: Layout;
  scope?: CaptureScope;
  initial?: { data: Group[]; meta: { nextCursor: string | null } };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('captures');
  const query = useCaptures(scope, initial);
  const groups = query.data?.data ?? [];
  const approval = useReviewAction<'ready'>();
  const [saves] = useState(() => new Map<string, Promise<boolean>>());
  const reread = async () => (await query.refetch()).data?.data ?? [];
  useUndoFocusFallback(query.data?.data);
  return (
    <InboxContext value={{ groups, layout, scope, saves, reread }}>
      <div className="grid gap-4" data-inbox>
        <header className="flex flex-wrap items-start gap-3">
          <div className="grid flex-1 gap-0.5">
            <h1 tabIndex={-1} className="font-display text-2xl">
              {t('review')}
            </h1>
            <p className="text-sm text-text-muted">
              {t('waiting', { count: pendingOf(groups).length })}
            </p>
          </div>
          {groups.length > 0 && <ApproveReadyButton approval={approval} />}
          {actions}
        </header>
        {approval.error && <ErrorPanel error={approval.error} />}
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorPanel error={query.error} />
        ) : (
          children
        )}
      </div>
    </InboxContext>
  );
}
// S17 Undo: a restored recording takes focus when it is listed (CaptureGroup). The list it was
// restored into is the first one read after Undo, so when the list moves on from the one shown at
// that moment and still lacks the recording, it is not coming: focus goes to the inbox heading.
// Runs after the groups' own layout effects, so a group that took the focus has already cleared it.
// `listed` is the query's own array, so its identity changes only when the list does.
function useUndoFocusFallback(listed: Group[] | undefined) {
  const pending = usePendingFocus();
  const shown = useRef<{ id: string; groups: Group[] | undefined } | null>(null);
  useLayoutEffect(() => {
    const id = pendingFocusId();
    if (!id || listed?.some((group) => group.id === id)) {
      shown.current = null;
      return;
    }
    if (shown.current?.id !== id) shown.current = { id, groups: listed };
    else if (shown.current.groups !== listed && takePendingFocus(id)) {
      shown.current = null;
      if (focusWasLost()) focusInboxHeading();
    }
  }, [pending, listed]);
  // An inbox that goes (the panel closed, another page) takes a waiting focus with it, so a later
  // inbox listing that recording does not jump to it.
  useLayoutEffect(
    () => () => {
      const id = pendingFocusId();
      if (id) takePendingFocus(id);
    },
    [],
  );
}
// The drafts whose latest save failed, once every save in flight has answered.
async function failedSaves(saves: Map<string, Promise<boolean>>) {
  const ids = [...saves.keys()];
  const outcomes = await Promise.allSettled(saves.values());
  return new Set(
    ids.filter((_, at) => {
      const outcome = outcomes[at];
      return outcome?.status !== 'fulfilled' || !outcome.value;
    }),
  );
}
// S23: every draft shown with nothing required left to settle; a type flag never holds one back.
// An edit still being saved is waited for, then the list is read again, so the batch is what the
// fields show; a draft whose latest save failed is left out. What was ready at the click and is
// not approved is said (its save failed, or it is no longer ready), and focus goes to the first.
export function ApproveReadyButton({
  approval: { busy, run },
}: {
  approval: ReturnType<typeof useReviewAction<'ready'>>;
}) {
  const t = useTranslations('captures');
  const { groups, saves, reread } = useInbox();
  const mutations = useReviewMutations();
  const toast = useReviewToast();
  const message = useApprovedMessage();
  const ready = readyOf(groups);
  if (!ready.length)
    return (
      <Button variant="secondary" aria-disabled>
        {t('noneReady')}
      </Button>
    );
  async function approveReady() {
    const clicked = ready.map((draft) => draft.id);
    const failed = await failedSaves(saves);
    const fresh = readyOf(await reread()).filter((draft) => !failed.has(draft.id));
    const { data } = fresh.length
      ? await mutations.approveReady(fresh.map((draft) => draft.id))
      : { data: { approved: [] } };
    const approved = new Set(data.approved.map((item) => item.suggestion.id));
    const skipped = clicked.filter((id) => !approved.has(id));
    const unsaved = skipped.filter((id) => failed.has(id)).length;
    const notReady = skipped.length - unsaved;
    const [only] = data.approved;
    if (only)
      toast.approved(
        data.approved.length === 1
          ? message(only)
          : t('approvedMany', { count: data.approved.length }),
        data.approved,
        [
          ...(unsaved ? [t('skippedUnsaved', { count: unsaved })] : []),
          ...(notReady ? [t('skippedNotReady', { count: notReady })] : []),
        ],
      );
    else toast.notice(t('noneApproved'));
    if (skipped[0]) listedDraft(skipped[0])?.focus();
  }
  return (
    <Button
      aria-busy={busy === 'ready' || undefined}
      aria-disabled={busy === 'ready' || undefined}
      onClick={() => run('ready', approveReady)}
    >
      {busy === 'ready' ? (
        <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
      ) : (
        <CheckCheck aria-hidden />
      )}
      {t('approveReady', { count: ready.length })}
    </Button>
  );
}
function Education() {
  return <InboxEducation />;
}
function Groups() {
  const { groups, layout } = useInbox();
  if (!groups.length) return null;
  return (
    <div className="grid gap-6">
      {groups.map((group) => (
        <CaptureGroup key={group.id} group={group} layout={layout} />
      ))}
    </div>
  );
}
// S16: nothing waiting, and the way to record.
function Empty() {
  const t = useTranslations('captures');
  const { groups } = useInbox();
  if (groups.length) return null;
  return (
    <div className="grid justify-items-center gap-3 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft">
        <Inbox aria-hidden className="size-7" />
      </span>
      <p className="font-medium">{t('emptyTitle')}</p>
      <p className="text-sm text-text-muted">{t('emptyHint')}</p>
      <Button variant="outline" onClick={startCapture} aria-keyshortcuts={t('shortcut')}>
        <Mic aria-hidden />
        {t('recordNote')}
        <kbd
          translate="no"
          aria-hidden
          className="hidden rounded border px-1.5 py-0.5 text-[11px] lg:inline"
        >
          {t('shortcut')}
        </kbd>
      </Button>
    </div>
  );
}
// Administrators may look at everyone's drafts (CAPTURES-B02, §9 decision 6).
function Scope() {
  const t = useTranslations('captures');
  const { scope } = useInbox();
  return (
    <Link
      className="inline-flex min-h-6 items-center text-sm underline underline-offset-4 pointer-coarse:min-h-11"
      href={scope === 'all' ? routes.captures() : routes.captures({ scope: 'all' })}
    >
      {scope === 'all' ? t('showMine') : t('showEveryone')}
    </Link>
  );
}
export const CaptureInbox = { Root, Education, Group: CaptureGroup, Groups, Empty, Scope };
