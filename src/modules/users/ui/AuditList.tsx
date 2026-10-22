'use client';
import { useTranslations, useTimeZone } from 'next-intl';
import {
  Activity,
  Archive,
  ArrowUpDown,
  CircleCheck,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';
import { cn } from '@/ui/cn';
import { addDays, dayAt } from '@/core/time/tasks';
import { defaults } from '@/core/config/defaults';
import { useDateTime, usePlainDate, useRelativeTime, useToday } from '@/ui/format';
import { useAuditChanges } from './audit-changes';
import { ActionKey, EntityKey } from './audit-keys';
export const AuditRow = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  actorName: z.string().nullable().optional(),
  createdAt: z.string(),
  diff: z.json().optional(),
});
type Entry = z.infer<typeof AuditRow>;
type Shown = Entry & { count: number };
// ADMIN-B43: the audit log reads as a history, not as a database dump: the changes grouped by day,
// each one a sentence (what was done to what, and to which record when the change names it), who
// did it and when, with the changed values folded away under Details for the rare time they are
// wanted. Words are the catalog's; an action or a kind the catalog does not know yet is shown as
// its own name with the punctuation taken out, so a new module's entries still read.
export function AuditList({ rows }: { rows: Entry[] }) {
  const days = useDays(rows);
  return (
    <div className="grid gap-6">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label} className="grid gap-2">
          <h2 className="text-sm font-medium">{day.label}</h2>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border bg-bg/50">
            {day.rows.map((row) => (
              <AuditItem key={row.id} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
function useDays(rows: Entry[]) {
  const t = useTranslations('admin');
  const timeZone = useTimeZone() ?? defaults.timezone;
  const today = useToday();
  const plainDate = usePlainDate();
  const days: { key: string; label: string; rows: Shown[] }[] = [];
  for (const row of rows) {
    const key = dayAt(timeZone, row.createdAt);
    let day = days.at(-1);
    if (day?.key !== key) {
      const label =
        key === today
          ? t('auditToday')
          : key === addDays(today, -1)
            ? t('auditYesterday')
            : plainDate(key);
      day = { key, label, rows: [] };
      days.push(day);
    }
    // One reorder writes one entry per item it moved; the reader made one change, so it shows once.
    const previous = day.rows.at(-1);
    if (
      previous &&
      row.action === 'reorder' &&
      previous.action === 'reorder' &&
      previous.entityType === row.entityType &&
      previous.actorName === row.actorName
    )
      previous.count += 1;
    else day.rows.push({ ...row, count: 1 });
  }
  return days;
}
const icons: [RegExp, LucideIcon, 'danger' | 'success' | 'neutral'][] = [
  [/^ai\./u, Sparkles, 'neutral'],
  [/download/u, Download, 'neutral'],
  [/delete|remove|purge/u, Trash2, 'danger'],
  [/archive/u, Archive, 'neutral'],
  [/restore|undo|reopen/u, RotateCcw, 'neutral'],
  [/complete/u, CircleCheck, 'success'],
  [/reorder|move/u, ArrowUpDown, 'neutral'],
  [/create|add/u, Plus, 'success'],
  [/update|edit|save|set/u, Pencil, 'neutral'],
];
function iconOf(action: string) {
  const found = icons.find(([pattern]) => pattern.test(action));
  return { Icon: found?.[1] ?? Activity, tone: found?.[2] ?? 'neutral' };
}
// The record a change names, when it carries one: a title, a name or a setting's key.
function subjectOf(diff: Entry['diff']) {
  const parsed = z
    .object({
      title: z.string().optional(),
      name: z.string().optional(),
      fullName: z.string().optional(),
      key: z.string().optional(),
    })
    .safeParse(diff);
  if (!parsed.success) return null;
  return parsed.data.title ?? parsed.data.name ?? parsed.data.fullName ?? parsed.data.key ?? null;
}
const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);
// A setting is named the way the settings page names it, not by its key.
const settingNames: Record<
  string,
  | 'settingsName'
  | 'settingsPrincipal'
  | 'settingsLanguage'
  | 'settingsTimezone'
  | 'settingsNumerals'
  | 'wallpaper'
  | 'settingsTrashDays'
  | 'settingsFilesDays'
  | 'settingsBackupCount'
  | 'settingsKpis'
  | 'settingsDefaultView'
> = {
  'workspace.name': 'settingsName',
  'workspace.principal_person_id': 'settingsPrincipal',
  'workspace.default_locale': 'settingsLanguage',
  'workspace.timezone': 'settingsTimezone',
  'workspace.arabic_numerals': 'settingsNumerals',
  'workspace.wallpaper': 'wallpaper',
  'retention.trash_days': 'settingsTrashDays',
  'retention.meeting_files_days': 'settingsFilesDays',
  'retention.backup_count': 'settingsBackupCount',
  'kpis.status_thresholds': 'settingsKpis',
  'tasks.default_view': 'settingsDefaultView',
};
const humanize = (raw: string) => raw.replace(/[._]+/gu, ' ').trim();
function AuditItem({ row }: { row: Shown }) {
  const t = useTranslations('admin');
  const relative = useRelativeTime();
  const dateTime = useDateTime();
  const { Icon, tone } = iconOf(row.action);
  const actionKey = ActionKey.safeParse(row.action.replaceAll('.', '_'));
  const entityKey = EntityKey.safeParse(row.entityType);
  const action = actionKey.success ? t(`auditAction_${actionKey.data}`) : humanize(row.action);
  const entity = entityKey.success ? t(`auditEntity_${entityKey.data}`) : humanize(row.entityType);
  const subject = row.entityType === 'setting' ? null : subjectOf(row.diff);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
          tone === 'danger' && 'bg-danger-soft text-danger',
          tone === 'success' && 'bg-surface-raised text-success',
          tone === 'neutral' && 'bg-surface-raised text-accent',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-sm">
          {row.count > 1
            ? t('auditEventMany', { action, entity, count: row.count })
            : t('auditEvent', { action, entity })}
          {subject && (
            <>
              {' '}
              <bdi dir="auto" className="text-text-muted">
                {settingNames[subject] ? t(settingNames[subject]) : clip(subject)}
              </bdi>
            </>
          )}
        </span>
        <span className="text-xs font-light text-text-muted">
          <bdi>{row.actorName ?? t('auditSystem')}</bdi>
          {' · '}
          <time dateTime={row.createdAt} title={dateTime(row.createdAt)}>
            {relative(row.createdAt)}
          </time>
        </span>
        <AuditChanges row={row} />
      </span>
    </li>
  );
}
// The change itself, as a short list of what now reads differently, under the sentence.
function AuditChanges({ row }: { row: Entry }) {
  const describe = useAuditChanges();
  const changes = describe(row.entityType, row.diff);
  if (!changes.length) return null;
  return (
    <ul className="grid gap-0.5 text-xs font-light text-text-muted">
      {changes.map((change) => (
        <li key={change.label}>
          <span className="text-text">{change.label}:</span> <bdi dir="auto">{change.value}</bdi>
        </li>
      ))}
    </ul>
  );
}
