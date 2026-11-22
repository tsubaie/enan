'use client';
import { useState, type ReactNode } from 'react';
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
import { useReviewAction } from './review-action';
import { InboxContext, useInbox } from './inbox-state';
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
// S23: every draft shown with nothing required left to settle; a type flag never holds one back.
// An edit still being saved is waited for, then the list is read again, so the batch is what the
// fields show; a draft whose latest save failed is left out.
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
  return (
    <Button
      aria-busy={busy === 'ready' || undefined}
      aria-disabled={busy === 'ready' || undefined}
      onClick={() =>
        run('ready', async () => {
          const ids = [...saves.keys()];
          const outcomes = await Promise.allSettled(saves.values());
          const failed = new Set(
            ids.filter((_, at) => {
              const outcome = outcomes[at];
              return outcome?.status !== 'fulfilled' || !outcome.value;
            }),
          );
          const fresh = readyOf(await reread()).filter((draft) => !failed.has(draft.id));
          if (!fresh.length) return;
          const { data } = await mutations.approveReady(fresh.map((draft) => draft.id));
          const [only] = data.approved;
          toast.approved(
            only && data.approved.length === 1
              ? message(only)
              : t('approvedMany', { count: data.approved.length }),
            data.approved,
          );
        })
      }
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
