'use client';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { ChevronRight, Database } from 'lucide-react';
import { useAdminResource, useAdminAction } from './queries';
import { Button } from '@/ui/primitives/button';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { AiControls } from './AiControls';
import { AiModels } from './AiModels';
import { AiConnection, Connection } from './AiCredentials';
import { AuditList, AuditRow } from './AuditList';
import { AdminRow } from './AdminRows';
const Rows = z.array(
  z.object({
    id: z.string(),
    createdAt: z.string(),
    status: z.string().optional(),
    kind: z.string().optional(),
    action: z.string().optional(),
    entityType: z.string().optional(),
    lastError: z.string().nullable().optional(),
    diff: z.json().optional(),
    files: z.record(z.string(), z.object({ bytes: z.number() })).optional(),
  }),
);
// ADMIN-B46: the backups list carries the latest backup job and whether this server runs jobs.
const BackupJob = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  createdAt: z.string(),
  lastError: z.string().nullable(),
});
const BackupsMeta = z.object({ runner: z.boolean(), job: BackupJob.nullable() });
type BackupsMeta = z.infer<typeof BackupsMeta>;
const Started = z.object({ id: z.string() });
type Resource = 'ai' | 'backups' | 'jobs' | 'audit';
type ListResource = Exclude<Resource, 'ai'>;
type Row = z.infer<typeof Rows>[number];
type Action = ReturnType<typeof useAdminAction>;
const emptyKey: Record<ListResource, 'noBackups' | 'noJobs' | 'noAudit'> = {
  backups: 'noBackups',
  jobs: 'noJobs',
  audit: 'noAudit',
};
export function AdminDataPage({ resource }: { resource: Resource }) {
  const query = useAdminResource(resource);
  const action = useAdminAction(resource);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  if (resource === 'ai')
    return <AiPanel connection={Connection.parse(query.data.data)} action={action} />;
  if (resource === 'audit') {
    const rows = z.array(AuditRow).parse(query.data.data);
    return rows.length ? (
      <AuditList rows={rows} />
    ) : (
      <p className="rounded-xl border bg-bg/50 p-8 text-sm font-light text-text-muted">
        <EmptyAudit />
      </p>
    );
  }
  const meta = resource === 'backups' ? BackupsMeta.safeParse(query.data.meta) : null;
  return (
    <ResourceList
      resource={resource}
      rows={Rows.parse(query.data.data)}
      action={action}
      meta={meta?.success ? meta.data : null}
    />
  );
}
// ADMIN-B45: the AI page in three short parts, connection, features and this month's usage, with
// the choice of models and what is sent to the provider folded under Advanced for the rare visit.
function AiPanel({
  connection,
  action,
}: {
  connection: z.infer<typeof Connection>;
  action: Action;
}) {
  const t = useTranslations('admin');
  return (
    <div className="grid gap-2">
      <AiConnection connection={connection} action={action} />
      <AiControls />
      <details className="kpi-fold mt-8">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-sm font-medium">
          <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden />
          {t('aiAdvanced')}
        </summary>
        <div className="mt-3 grid gap-4">
          <AiModels />
          <div className="rounded-xl border bg-bg/50 p-5">
            <h2 className="mb-2 text-sm font-medium">{t('disclosure')}</h2>
            <p className="text-sm leading-relaxed font-light text-text-muted">
              {t('noCapabilities')}
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
function ResourceList({
  resource,
  rows,
  action,
  meta,
}: {
  resource: ListResource;
  rows: Row[];
  action: Action;
  meta: BackupsMeta | null;
}) {
  const t = useTranslations('admin');
  const backups = resource === 'backups';
  const active = isActive(meta?.job?.status);
  return (
    <div className="space-y-5">
      {backups && <BackupsHeader action={action} active={active} />}
      {action.error && <ErrorPanel error={action.error} />}
      {backups && <BackupProgress action={action} meta={meta} rows={rows} />}
      {rows.length ? (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border bg-bg/50">
          {rows.map((row) => (
            <AdminRow key={row.id} resource={resource} row={row} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border bg-bg/50 p-8 text-sm text-text-muted">
          {t(emptyKey[resource])}
        </p>
      )}
      {backups && <RestoreHelp />}
    </div>
  );
}
function BackupsHeader({ action, active }: { action: Action; active: boolean }) {
  const t = useTranslations('admin');
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-sm text-text-muted">{t('backupDescription')}</p>
      <Button disabled={action.isPending || active} onClick={() => action.mutate()}>
        <Database className="size-4" />
        {t('createBackup')}
      </Button>
    </div>
  );
}
// ADMIN-B46: what became of Create backup, told as it is. A backup still to come is shown as its
// job, with its state, while the list polls; on a server that does not run background jobs the page
// says so and that the backup will not be made until they are turned on, instead of implying it
// will finish. The backup started from this page is also reported once it is listed or has failed.
type Progress =
  | 'backupInProgress'
  | 'backupWaitingRunnerOff'
  | 'backupRunnerOff'
  | 'backupFinished'
  | 'backupFailed'
  | 'backupStarted';
const isActive = (status: string | undefined) => status === 'queued' || status === 'running';
function progressOf(meta: BackupsMeta, startedId: string | null, rows: Row[]): Progress | null {
  const job = meta.job;
  if (isActive(job?.status)) return meta.runner ? 'backupInProgress' : 'backupWaitingRunnerOff';
  if (!meta.runner) return 'backupRunnerOff';
  if (!startedId) return null;
  if (rows.some((row) => row.id === startedId)) return 'backupFinished';
  if (job?.id === startedId && job.status !== 'succeeded') return 'backupFailed';
  return 'backupStarted';
}
function BackupProgress({
  action,
  meta,
  rows,
}: {
  action: Action;
  meta: BackupsMeta | null;
  rows: Row[];
}) {
  const t = useTranslations('admin');
  if (!meta) return null;
  const started = Started.safeParse(action.data?.data);
  const progress = progressOf(meta, started.success ? started.data.id : null, rows);
  if (!progress) return null;
  const warn = progress === 'backupFailed' || !meta.runner;
  const showJob = meta.job && (isActive(meta.job.status) || progress === 'backupFailed');
  return (
    <div className="grid gap-2">
      <p role="status" className={warn ? 'text-sm text-danger' : 'text-sm text-text-muted'}>
        {t(progress)}
      </p>
      {showJob && meta.job && (
        <ul className="overflow-hidden rounded-xl border bg-bg/50">
          <AdminRow resource="jobs" row={meta.job} />
        </ul>
      )}
    </div>
  );
}
// ADMIN-B41: in-app restore is not built yet, so the page says so calmly instead of showing a
// server command, and reminds that a downloaded backup is already safe to keep.
function RestoreHelp() {
  const t = useTranslations('admin');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-xl border bg-bg/50 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="font-medium">
          {t('restoreTitle')}
        </h2>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-light text-secondary-foreground">
          {t('restoreSoon')}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed font-light text-text-muted">
        {t('restoreComingSoon')}
      </p>
    </section>
  );
}
function EmptyAudit() {
  const t = useTranslations('admin');
  return <>{t('noAudit')}</>;
}
