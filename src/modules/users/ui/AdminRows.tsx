'use client';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Cog, Download, ShieldCheck, Trash2, WandSparkles } from 'lucide-react';
import { z } from 'zod';
import { cn } from '@/ui/cn';
import { useDateTime, useNumberingSystem, useRelativeTime } from '@/ui/format';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui/primitives/dialog';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { useDeleteBackup } from './queries';
export type Row = {
  id: string;
  createdAt: string;
  status?: string | undefined;
  kind?: string | undefined;
  lastError?: string | null | undefined;
  files?: Record<string, { bytes: number }> | undefined;
};
// ADMIN-B43: a backup or a background job is one row of an inset sheet: an icon, its name in words
// where the catalog has one, when it was made, and its state as a chip that says it in words.
const JobState = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const JobKind = z.enum([
  'system_backup',
  'ai_notes_refine',
  'ai_notes_suggest_tags',
  'ai_tasks_breakdown',
  'users_updates',
]);
const stateTone: Record<z.infer<typeof JobState>, string> = {
  queued: 'bg-surface-raised text-text-muted',
  running: 'bg-accent-soft text-accent',
  succeeded: 'bg-surface-raised text-success',
  failed: 'bg-danger-soft text-danger',
  cancelled: 'bg-surface-raised text-text-faint',
};
export function AdminRow({ resource, row }: { resource: 'backups' | 'jobs' | 'audit'; row: Row }) {
  const t = useTranslations('admin');
  const dateTime = useDateTime();
  const relative = useRelativeTime();
  const state = JobState.safeParse(row.status);
  const kind = JobKind.safeParse((row.kind ?? '').replaceAll('.', '_'));
  const Icon =
    resource === 'backups'
      ? ShieldCheck
      : kind.success && kind.data.startsWith('ai')
        ? WandSparkles
        : Cog;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-accent">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-sm">
          {resource === 'backups' ? (
            t('backupNamed', { date: dateTime(row.createdAt) })
          ) : kind.success ? (
            t(`jobKind_${kind.data}`)
          ) : (
            <bdi dir="ltr">{row.kind ?? row.id}</bdi>
          )}
        </span>
        <time
          dateTime={row.createdAt}
          title={dateTime(row.createdAt)}
          className="text-xs font-light text-text-muted"
        >
          {relative(row.createdAt)}
        </time>
        {row.lastError && <p className="text-sm font-light text-danger">{row.lastError}</p>}
      </span>
      {resource === 'backups' && <BackupDownload row={row} />}
      {resource === 'backups' && <BackupDelete row={row} />}
      {state.success && (
        <span
          className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px]', stateTone[state.data])}
        >
          {t(`jobState_${state.data}`)}
        </span>
      )}
    </li>
  );
}
// ADMIN-B44: each backup can be downloaded as one .tar file; the button says how large it is.
function BackupDownload({ row }: { row: Row }) {
  const t = useTranslations('admin');
  const format = useFormatter();
  const numberingSystem = useNumberingSystem();
  const bytes = Object.values(row.files ?? {}).reduce((sum, file) => sum + file.bytes, 0);
  return (
    <a
      href={`/api/v1/admin/backups/${row.id}/download`}
      download
      className="inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-full bg-secondary px-3 text-xs font-light text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Download className="size-3.5" aria-hidden />
      {t('backupDownload')}
      {bytes > 0 && (
        <span className="text-text-muted tabular-nums">
          {format.number(bytes / 1_000_000, {
            numberingSystem,
            style: 'unit',
            unit: 'megabyte',
            unitDisplay: 'short',
            maximumFractionDigits: 1,
          })}
        </span>
      )}
    </a>
  );
}
// ADMIN-B12: deleting a backup is for good, so it is confirmed. The dialog stays open until the
// server agrees, and says so when it does not.
function BackupDelete({ row }: { row: Row }) {
  const t = useTranslations('admin');
  const dateTime = useDateTime();
  const [open, setOpen] = useState(false);
  const remove = useDeleteBackup();
  return (
    <>
      <Button
        size="icon-sm"
        variant="secondary"
        className="self-center"
        aria-label={t('backupDelete', { date: dateTime(row.createdAt) })}
        onClick={() => {
          remove.reset();
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t('backupDeleteTitle')}</DialogTitle>
          <DialogDescription>{t('backupDeleteConfirm')}</DialogDescription>
          {remove.error && <ErrorPanel error={remove.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('backupKeep')}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(row.id, { onSuccess: () => setOpen(false) })}
            >
              {t('backupDeleteAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
