'use client';
import { useTranslations } from 'next-intl';
import { Segmented } from '@/ui/primitives/segmented';
import { ChoiceSelect } from '@/ui/layout/ChoiceSelect';
import { PropertySheet } from '@/ui/layout/Property';
import { RecordSection } from '@/ui/layout/Record';
import { Locale } from '@/core/config/defaults';
import { View as TaskView } from '@/modules/tasks/schema/validation';
import { usePersonChoices } from './queries';
import {
  NumberSetting,
  SettingRowFrame,
  TextSetting,
  type Save,
  type SettingRow,
} from './SettingControls';
type Rows = (key: string) => SettingRow | undefined;
const NONE = 'none';
// Who the workspace is for and how it reads: its name, the person it serves, its language, its
// clock and its numerals.
export function WorkspaceSection({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const name = row('workspace.name');
  const timezone = row('workspace.timezone');
  return (
    <RecordSection title={t('settingsWorkspace')}>
      <PropertySheet>
        {name && <TextSetting setting={name} save={save} label={t('settingsName')} />}
        <PrincipalSetting row={row} save={save} />
        <LanguageSetting row={row} save={save} />
        {timezone && (
          <SettingRowFrame label={t('settingsTimezone')} setting={timezone} save={save}>
            <ChoiceSelect
              label={t('settingsTimezone')}
              value={String(timezone.value)}
              items={Intl.supportedValuesOf('timeZone').map((zone) => ({
                value: zone,
                text: zone,
                label: <bdi dir="ltr">{zone.replaceAll('_', ' ')}</bdi>,
              }))}
              onChange={(value) => save({ key: timezone.key, value })}
            />
          </SettingRowFrame>
        )}
        <NumeralsSetting row={row} save={save} />
      </PropertySheet>
    </RecordSection>
  );
}
function PrincipalSetting({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const people = usePersonChoices();
  const setting = row('workspace.principal_person_id');
  if (!setting) return null;
  const value = typeof setting.value === 'string' ? setting.value : NONE;
  return (
    <SettingRowFrame label={t('settingsPrincipal')} setting={setting} save={save}>
      <ChoiceSelect
        label={t('settingsPrincipal')}
        value={value}
        items={[
          { value: NONE, text: t('settingsPrincipalNone'), label: t('settingsPrincipalNone') },
          ...(people.data?.data ?? []).map((person) => ({
            value: person.id,
            text: person.fullName,
            label: <bdi>{person.fullName}</bdi>,
          })),
        ]}
        onChange={(next) => save({ key: setting.key, value: next === NONE ? null : next })}
      />
    </SettingRowFrame>
  );
}
function LanguageSetting({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const setting = row('workspace.default_locale');
  if (!setting) return null;
  const parsed = Locale.safeParse(setting.value);
  return (
    <SettingRowFrame label={t('settingsLanguage')} setting={setting} save={save}>
      <Segmented
        label={t('settingsLanguage')}
        value={parsed.success ? parsed.data : 'en'}
        segments={[
          { value: 'ar', label: t('languageArabic') },
          { value: 'en', label: t('languageEnglish') },
        ]}
        onChange={(value) => save({ key: setting.key, value })}
      />
    </SettingRowFrame>
  );
}
function NumeralsSetting({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const setting = row('workspace.arabic_numerals');
  if (!setting) return null;
  return (
    <SettingRowFrame label={t('settingsNumerals')} setting={setting} save={save}>
      <Segmented
        label={t('settingsNumerals')}
        value={setting.value === true ? 'arabic' : 'western'}
        segments={[
          // One run of digits each, so neither reorders inside the other language's text.
          { value: 'western', label: '123' },
          { value: 'arabic', label: '١٢٣' },
        ]}
        onChange={(value) => save({ key: setting.key, value: value === 'arabic' })}
      />
    </SettingRowFrame>
  );
}
// How long things are kept: the trash, meeting files and backups. ADMIN-B48: 0 on any of them
// means never, and each row says so under its field and, at 0, in place of its unit.
export function RetentionSection({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const trash = row('retention.trash_days');
  const files = row('retention.meeting_files_days');
  const backups = row('retention.backup_count');
  return (
    <RecordSection title={t('settingsRetention')}>
      <PropertySheet>
        {trash && (
          <NumberSetting
            setting={trash}
            save={save}
            label={t('settingsTrashDays')}
            unit={t('unitDays')}
            zero={t('settingsTrashNever')}
            hint={t('settingsTrashHint', { zero: 0 })}
            min={0}
            max={3650}
          />
        )}
        {files && (
          <NumberSetting
            setting={files}
            save={save}
            label={t('settingsFilesDays')}
            unit={t('unitDays')}
            zero={t('settingsFilesNever')}
            hint={t('settingsFilesHint', { zero: 0 })}
            min={0}
            max={3650}
          />
        )}
        {backups && (
          <NumberSetting
            setting={backups}
            save={save}
            label={t('settingsBackupCount')}
            unit={t('unitBackups')}
            zero={t('settingsBackupsNever')}
            hint={t('settingsBackupsHint', { zero: 0 })}
            min={0}
            max={100}
          />
        )}
      </PropertySheet>
    </RecordSection>
  );
}
// Where the Tasks page opens.
export function TasksSection({ row, save }: { row: Rows; save: Save }) {
  const t = useTranslations('admin');
  const tasks = useTranslations('tasks');
  const setting = row('tasks.default_view');
  if (!setting) return null;
  const views = TaskView.options.filter((view) => view !== 'trash');
  return (
    <RecordSection title={t('settingsTasks')}>
      <PropertySheet>
        <SettingRowFrame label={t('settingsDefaultView')} setting={setting} save={save}>
          <ChoiceSelect
            label={t('settingsDefaultView')}
            value={String(setting.value)}
            items={views.map((view) => ({ value: view, text: tasks(view), label: tasks(view) }))}
            onChange={(value) => save({ key: setting.key, value })}
          />
        </SettingRowFrame>
      </PropertySheet>
    </RecordSection>
  );
}
