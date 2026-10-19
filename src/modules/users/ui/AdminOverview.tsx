'use client';
import { useId, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { ChevronRight, CircleAlert, CircleCheck } from 'lucide-react';
import { routes, type AdminPage } from '@/core/routes';
import { adminSections } from '@/ui/layout/admin-sections';
import { useDateTime, useRelativeTime } from '@/ui/format';
import { useAdminResource, useUsers } from './queries';
import {
  attentionOf,
  readAi,
  readJobs,
  readLatest,
  readMembers,
  type AdminSummary,
  type AiReading,
  type Attention,
} from './admin-summary';
// ADMIN-B39: the administration overview answers "is anything wrong?" first, then lists every
// administration page with its current state, which also makes it the way between pages on a
// phone (ADMIN-B40).
export function AdminOverview() {
  const summary = useAdminSummary();
  const ready = summary.jobs !== undefined && summary.lastBackupAt !== undefined && !!summary.ai;
  return (
    <div className="max-w-3xl space-y-8">
      {ready && <AttentionList items={attentionOf(summary)} summary={summary} />}
      {adminSections.map((section) => (
        <SectionIndex key={section.group} section={section} summary={summary} />
      ))}
    </div>
  );
}
function useAdminSummary(): AdminSummary {
  const users = useUsers();
  const ai = useAdminResource('ai', { summary: true });
  const backups = useAdminResource('backups', { summary: true });
  const jobs = useAdminResource('jobs', { summary: true });
  const audit = useAdminResource('audit', { summary: true });
  return {
    ...(users.data && { members: readMembers(users.data.data) }),
    ...(ai.data && { ai: readAi(ai.data.data) }),
    ...(backups.data && { lastBackupAt: readLatest(backups.data.data) }),
    ...(jobs.data && { jobs: readJobs(jobs.data.data) }),
    ...(audit.data && { lastChangeAt: readLatest(audit.data.data) }),
  };
}
const attentionTarget: Record<
  Attention,
  { page: AdminPage; action: 'reviewJobs' | 'openBackups' | 'openAi' }
> = {
  failedJobs: { page: 'jobs', action: 'reviewJobs' },
  noBackup: { page: 'backups', action: 'openBackups' },
  aiFailed: { page: 'ai', action: 'openAi' },
};
function AttentionList({ items, summary }: { items: Attention[]; summary: AdminSummary }) {
  const t = useTranslations('admin');
  const titleId = useId();
  if (!items.length)
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
        {t('attentionNone')}
      </p>
    );
  // What needs doing sits on the same inset sheet as everything else, one row per item: the warning
  // is carried by the icon and the heading's ink, not by flooding the panel with amber.
  return (
    <section aria-labelledby={titleId} className="grid gap-2">
      <h2 id={titleId} className="text-sm font-medium text-warning">
        {t('attentionTitle')}
      </h2>
      <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border bg-bg/50">
        {items.map((item) => (
          <li key={item} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-soft">
                <CircleAlert className="size-4 text-warning" aria-hidden />
              </span>
              <span className="text-sm">
                {item === 'failedJobs'
                  ? t('attentionFailedJobs', { count: summary.jobs?.failed ?? 0 })
                  : item === 'noBackup'
                    ? t('attentionNoBackup')
                    : t('attentionAiFailed')}
              </span>
            </span>
            <Link
              href={routes.admin(attentionTarget[item].page)}
              className="inline-flex h-7 shrink-0 items-center rounded-full bg-secondary px-3 text-xs font-light text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {t(attentionTarget[item].action)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
function SectionIndex({
  section,
  summary,
}: {
  section: (typeof adminSections)[number];
  summary: AdminSummary;
}) {
  const t = useTranslations('admin');
  return (
    <section aria-labelledby={`admin-index-${section.group}`}>
      <h2 id={`admin-index-${section.group}`} className="mb-2 text-sm font-medium">
        {t(section.group)}
      </h2>
      <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border bg-bg/50">
        {section.pages.map(({ page, icon: Icon }) => (
          <li key={page}>
            <Link
              href={routes.admin(page)}
              className="flex min-h-16 items-center gap-3.5 px-4 py-3 transition-colors hover:bg-[var(--nav-hover)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-raised">
                <Icon className="size-[18px] text-accent" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-nav">{t(page)}</span>
                <PageStatus page={page} summary={summary} />
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-text-faint rtl:rotate-180"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
const aiKey: Record<AiReading, 'connected' | 'aiConnectionFailed' | 'disabledAI' | 'aiNotTested'> =
  {
    connected: 'connected',
    failed: 'aiConnectionFailed',
    notConfigured: 'disabledAI',
    notTested: 'aiNotTested',
  };
const DescribedPage = z.enum(['settings', 'tasks', 'notes', 'objectives']);
const describedKey: Record<
  'settings' | 'tasks' | 'notes' | 'objectives',
  'overviewSettings' | 'overviewTasks' | 'overviewNotes' | 'overviewObjectives'
> = {
  settings: 'overviewSettings',
  tasks: 'overviewTasks',
  notes: 'overviewNotes',
  objectives: 'overviewObjectives',
};
function PageStatus({ page, summary }: { page: AdminPage; summary: AdminSummary }) {
  const t = useTranslations('admin');
  const c = useTranslations('common');
  const loading = <Line faint>{c('loading')}</Line>;
  const described = DescribedPage.safeParse(page);
  if (described.success) return <Line>{t(describedKey[described.data])}</Line>;
  switch (page) {
    case 'users':
      return summary.members ? <Line>{t('overviewMembers', summary.members)}</Line> : loading;
    case 'ai':
      return summary.ai ? <Line>{t(aiKey[summary.ai])}</Line> : loading;
    case 'jobs':
      return summary.jobs ? <JobsLine jobs={summary.jobs} /> : loading;
    case 'backups':
    case 'audit':
      return <HistoryLine page={page} summary={summary} loading={loading} />;
  }
}
function HistoryLine({
  page,
  summary,
  loading,
}: {
  page: 'backups' | 'audit';
  summary: AdminSummary;
  loading: ReactNode;
}) {
  const at = page === 'backups' ? summary.lastBackupAt : summary.lastChangeAt;
  if (at === undefined) return loading;
  return page === 'backups' ? (
    <Since at={at} label="overviewLastBackup" empty="noBackups" />
  ) : (
    <Since at={at} label="overviewLastChange" empty="noAudit" />
  );
}
function JobsLine({ jobs }: { jobs: { failed: number; active: number } }) {
  const t = useTranslations('admin');
  if (jobs.failed) return <Line>{t('overviewJobsFailed', { count: jobs.failed })}</Line>;
  if (jobs.active) return <Line>{t('overviewJobsActive', { count: jobs.active })}</Line>;
  return <Line>{t('overviewJobsClear')}</Line>;
}
function Since({
  at,
  label,
  empty,
}: {
  at: string | null;
  label: 'overviewLastBackup' | 'overviewLastChange';
  empty: 'noBackups' | 'noAudit';
}) {
  const t = useTranslations('admin');
  const relative = useRelativeTime();
  const dateTime = useDateTime();
  if (!at) return <Line>{t(empty)}</Line>;
  return (
    <Line>
      {t.rich(label, {
        ago: relative(at),
        time: (chunks) => (
          <time dateTime={at} title={dateTime(at)}>
            {chunks}
          </time>
        ),
      })}
    </Line>
  );
}
function Line({ children, faint = false }: { children: ReactNode; faint?: boolean }) {
  return (
    <span
      className={
        faint
          ? 'mt-0.5 block text-sm font-light text-text-faint'
          : 'mt-0.5 block text-sm font-light text-text-muted'
      }
    >
      {children}
    </span>
  );
}
