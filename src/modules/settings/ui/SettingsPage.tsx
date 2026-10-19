'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { routes } from '@/core/routes';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import Loading from '@/ui/layout/Loading';
import { useSettingsEditor } from './use-settings-editor';
import { WallpaperPicker } from './WallpaperPicker';
import { RetentionSection, TasksSection, WorkspaceSection } from './SettingSections';
import { ThresholdsSection } from './ThresholdsSection';
// ADMIN-B07: the workspace settings, in plain words and grouped by what they govern, each with the
// control its value calls for. Settings that belong to one part of the product live on that part's
// page (KPI status on Objectives, the opening view on Tasks, the AI and the note vocabularies on
// their own pages), so this page keeps to the workspace itself and points to the rest.
export function SettingsPage() {
  const t = useTranslations('admin');
  const { query, row, save, error } = useSettingsEditor();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  const wallpaper = row('workspace.wallpaper');
  return (
    <div className="grid gap-2">
      <p className="text-sm font-light text-text-muted">{t('settingsDescription')}</p>
      {error && <ErrorPanel error={error} />}
      <WorkspaceSection row={row} save={save} />
      {wallpaper && (
        <div className="mt-8">
          <WallpaperPicker value={String(wallpaper.value)} />
        </div>
      )}
      <RetentionSection row={row} save={save} />
      <p className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-light text-text-muted">
        {t('settingsElsewhere')}
        <MoreLink href={routes.admin('tasks')}>{t('tasks')}</MoreLink>
        <MoreLink href={routes.admin('objectives')}>{t('objectives')}</MoreLink>
        <MoreLink href={routes.admin('ai')}>{t('ai')}</MoreLink>
        <MoreLink href={routes.admin('notes')}>{t('notes')}</MoreLink>
      </p>
    </div>
  );
}
// One part of the product's settings, on that part's admin page.
export function TaskSettings() {
  const { query, row, save, error } = useSettingsEditor();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="grid gap-2">
      {error && <ErrorPanel error={error} />}
      <TasksSection row={row} save={save} />
    </div>
  );
}
export function KpiStatusSettings() {
  const { query, row, save, error } = useSettingsEditor();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorPanel error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="grid gap-2">
      {error && <ErrorPanel error={error} />}
      <ThresholdsSection row={row} save={save} />
    </div>
  );
}
function MoreLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-xs font-light text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {children}
      <ArrowUpRight aria-hidden className="size-3 rtl:-scale-x-100" />
    </Link>
  );
}
