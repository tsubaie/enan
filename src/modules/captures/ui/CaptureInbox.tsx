'use client';
import { createContext, use, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CheckCheck, Inbox, Mic } from 'lucide-react';
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
type Inbox = { groups: Group[]; layout: Layout; scope: CaptureScope };
const InboxContext = createContext<Inbox | null>(null);
function useInbox() {
  const inbox = use(InboxContext);
  if (!inbox) throw new Error('CaptureInbox.Root is missing');
  return inbox;
}
const pendingOf = (groups: Group[]) =>
  groups.flatMap((group) => group.suggestions.filter((draft) => draft.status === 'pending'));
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
  return (
    <InboxContext value={{ groups, layout, scope }}>
      <div className="grid gap-4">
        <header className="flex flex-wrap items-start gap-3">
          <div className="grid flex-1 gap-0.5">
            <h1 className="font-display text-2xl">{t('review')}</h1>
            <p className="text-sm text-text-muted">
              {t('waiting', { count: pendingOf(groups).length })}
            </p>
          </div>
          {groups.length > 0 && <ApproveReadyButton />}
          {actions}
        </header>
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
export function ApproveReadyButton() {
  const t = useTranslations('captures');
  const { groups } = useInbox();
  const mutations = useReviewMutations();
  const toast = useReviewToast();
  const message = useApprovedMessage();
  const ready = pendingOf(groups).filter((draft) => !blockers(draft).length);
  if (!ready.length)
    return (
      <Button variant="secondary" aria-disabled>
        {t('noneReady')}
      </Button>
    );
  return (
    <Button
      onClick={() =>
        void mutations.approveReady(ready.map((draft) => draft.id)).then(({ data }) => {
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
      <CheckCheck aria-hidden />
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
      className="text-sm underline underline-offset-4"
      href={scope === 'all' ? routes.captures() : routes.captures({ scope: 'all' })}
    >
      {scope === 'all' ? t('showMine') : t('showEveryone')}
    </Link>
  );
}
export const CaptureInbox = { Root, Education, Group: CaptureGroup, Groups, Empty, Scope };
