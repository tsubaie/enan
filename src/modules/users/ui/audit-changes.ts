'use client';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { SignInMethods } from '@/core/config/sign-in-schema';
import { useDateTime, usePlainDate } from '@/ui/format';
// ADMIN-B43: what a change did, as a reader would say it: each changed field by its everyday name
// and its new value in words (a state, a date, Yes or No), long text as "edited" rather than
// quoted, and internal identifiers and ordering numbers left out. A setting reads as its
// settings-page name and the value it was set to.
const Field = z.enum([
  'title',
  'name',
  'fullName',
  'displayName',
  'honorific',
  'organization',
  'roleTitle',
  'email',
  'phone',
  'kind',
  'isAssignable',
  'tags',
  'status',
  'priority',
  'dueDate',
  'completedAt',
  'archivedAt',
  'ownerId',
  'committeeId',
  'objectiveId',
  'content',
  'description',
  'notes',
  'type',
  'noteDate',
  'scope',
  'ownership',
  'value',
  'note',
  'readingDate',
  'unit',
  'frequency',
  'direction',
  'category',
  'targetValue',
  'year',
  'period',
  'role',
  'active',
]);
type FieldName = z.infer<typeof Field>;
const longText = new Set<FieldName>(['content', 'description', 'notes']);
const reference = new Set<FieldName>(['ownerId', 'committeeId', 'objectiveId']);
const TaskWord = z.enum([
  'inbox',
  'next_action',
  'waiting_on',
  'someday',
  'completed',
  'urgent',
  'high',
  'medium',
  'low',
]);
const KindWord = z.enum(['internal', 'external']);
const isoDay = /^\d{4}-\d{2}-\d{2}$/u;
const isoTime = /^\d{4}-\d{2}-\d{2}T/u;
// ADMIN-B71: `before` is what the field read before an edit, when the entry recorded it.
export type Change = { label: string; value: string; before?: string };
export type Json = z.infer<ReturnType<typeof z.json>>;
const blank = (raw: Json | undefined) =>
  raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
// ADMIN-B71: what a field was before reads the same as now: empty and empty, or equal.
const same = (before: Json | undefined, after: Json) =>
  before !== undefined &&
  ((blank(before) && blank(after)) || JSON.stringify(before) === JSON.stringify(after));
export function useAuditChanges() {
  const t = useTranslations('admin');
  const tasks = useTranslations('tasks');
  const common = useTranslations('common');
  const plainDate = usePlainDate();
  const dateTime = useDateTime();
  // A field's value in words: what kind of change it was, then what the value means.
  const word = (field: FieldName, raw: Json): string => {
    if (blank(raw)) return t('auditCleared');
    if (longText.has(field)) return t('auditEdited');
    if (reference.has(field)) return t('auditChanged');
    if (typeof raw === 'boolean') return raw ? t('auditYes') : t('auditNo');
    if (Array.isArray(raw)) return raw.map((item) => String(item)).join('، ');
    if (typeof raw === 'number') return String(raw);
    if (typeof raw === 'string') return text(field, raw);
    return t('auditChanged');
  };
  const text = (field: FieldName, raw: string): string => {
    const task = TaskWord.safeParse(raw);
    if (task.success && (field === 'status' || field === 'priority')) return tasks(task.data);
    const kind = KindWord.safeParse(raw);
    if (kind.success && (field === 'kind' || field === 'scope')) return common(kind.data);
    if (isoDay.test(raw)) return plainDate(raw);
    if (isoTime.test(raw)) return dateTime(raw);
    return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
  };
  // Long text and references read as "edited" and "changed" either way: no before to show.
  const before = (field: FieldName, was: Record<string, Json>, key: string) =>
    key in was && !longText.has(field) && !reference.has(field)
      ? word(field, was[key] ?? null)
      : undefined;
  // `created`: a new record lists what it was given; a field left empty was not cleared.
  return (entityType: string, diff: Json | undefined, created = false): Change[] => {
    const record = z.record(z.string(), z.json()).safeParse(diff);
    if (!record.success) return [];
    if (entityType === 'setting') return settingChange(record.data, t);
    // A sign-in's method and address are in its sentence; it changed nothing to list.
    if (entityType === 'session') return [];
    const changes: Change[] = [];
    const was = z.record(z.string(), z.json()).safeParse(record.data._before);
    // ADMIN-B71: a field the edit wrote but left as it was (a status change clears an empty
    // completion date) did not change, and a new record's empty field was not cleared.
    const unchanged = (key: string, raw: Json) =>
      (created && blank(raw)) || (was.success && same(was.data[key], raw));
    for (const [key, raw] of Object.entries(record.data)) {
      const field = Field.safeParse(key);
      if (!field.success || unchanged(key, raw)) continue;
      const value = word(field.data, raw);
      const prior = was.success ? before(field.data, was.data, key) : undefined;
      if (value)
        changes.push({
          label: t(`auditField_${field.data}`),
          value,
          ...(prior !== undefined && prior !== value ? { before: prior } : {}),
        });
    }
    return changes.slice(0, 5);
  };
}
type T = ReturnType<typeof useTranslations<'admin'>>;
const SettingKey = z.enum([
  'workspace.name',
  'workspace.principal_person_id',
  'workspace.default_locale',
  'workspace.timezone',
  'workspace.arabic_numerals',
  'workspace.wallpaper',
  'retention.trash_days',
  'retention.meeting_files_days',
  'retention.backup_count',
  'kpis.status_thresholds',
  'tasks.default_view',
  'auth.sign_in_methods',
]);
const settingLabel: Record<
  z.infer<typeof SettingKey>,
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
  | 'signInMethods'
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
  'auth.sign_in_methods': 'signInMethods',
};
const Wallpaper = z.enum(['ribbon', 'copper', 'jade', 'neon', 'folds', 'stone', 'arc', 'sky']);
function settingChange(diff: Record<string, Json>, t: T): Change[] {
  const key = SettingKey.safeParse(diff.key);
  if (!key.success) return [];
  const raw = diff.value;
  const label = t(settingLabel[key.data]);
  return [{ label, value: settingValue(key.data, raw, t) }];
}
function settingValue(key: z.infer<typeof SettingKey>, raw: Json | undefined, t: T) {
  const wallpaper = Wallpaper.safeParse(raw);
  if (key === 'workspace.arabic_numerals') return raw === true ? '١٢٣' : '123';
  if (key === 'workspace.default_locale')
    return raw === 'ar' ? t('languageArabic') : t('languageEnglish');
  if (wallpaper.success) return t(`wallpaper_${wallpaper.data}`);
  // ADMIN-B47: an uploaded wallpaper is named by its id, which says nothing to a reader.
  if (key === 'workspace.wallpaper') return t('wallpaper_custom');
  if (key === 'workspace.principal_person_id') return t('auditChanged');
  const methods = SignInMethods.safeParse(raw);
  if (key === 'auth.sign_in_methods' && methods.success)
    return methods.data.map((method) => t(`signInMethod_${method}`)).join(', ');
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
  return t('auditChanged');
}

const SignIn = z.object({
  method: z.enum(['password', 'code', 'google']).catch('password'),
  email: z.string().catch(''),
  address: z.string().optional(),
});
// ADMIN-B72: a sign-in reads as one, by its method; a failed attempt names the email that was
// tried, since nobody is known to have made it, and either shows the client address when known.
export function useSignIn() {
  const t = useTranslations('admin');
  return (row: {
    action: string;
    actorName?: string | null | undefined;
    diff?: Json | undefined;
  }) => {
    const attempt = SignIn.parse(row.diff ?? {});
    const where = attempt.address ? ` · ${attempt.address}` : '';
    return {
      sentence: t(row.action === 'sign_in' ? 'auditSignedIn' : 'auditSignInFailed', {
        method: attempt.method,
      }),
      who: `${row.actorName ?? attempt.email}${where}`,
    };
  };
}
