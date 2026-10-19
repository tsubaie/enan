// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { useAuditChanges, type Change } from '@/modules/users/ui/audit-changes';
import { AuditList } from '@/modules/users/ui/AuditList';
import { mount } from './harness';
// ADMIN-B43: the audit log reads as a history. The changes are read through the hook inside the
// app's providers (the harness's clock is 2026-09-10 09:00 UTC), and the list is read as rendered.
type Json = Parameters<ReturnType<typeof useAuditChanges>>[1];
function Probe({ entityType, diff }: { entityType: string; diff: Json }) {
  const changes = useAuditChanges()(entityType, diff);
  return <output>{JSON.stringify(changes)}</output>;
}
function changes(entityType: string, diff: Json, locale: 'en' | 'ar' = 'en'): Change[] {
  mount(<Probe entityType={entityType} diff={diff} />, locale);
  return JSON.parse(screen.getByRole('status').textContent ?? '[]');
}
describe('ADMIN-B43 audit changes', () => {
  it('ADMIN-B43 a setting reads as its settings-page name and the value in words', () => {
    expect(changes('setting', { key: 'workspace.arabic_numerals', value: true })).toEqual([
      { label: en.admin.settingsNumerals, value: '١٢٣' },
    ]);
    expect(changes('setting', { key: 'workspace.arabic_numerals', value: false })).toEqual([
      { label: en.admin.settingsNumerals, value: '123' },
    ]);
    expect(changes('setting', { key: 'workspace.default_locale', value: 'ar' })).toEqual([
      { label: en.admin.settingsLanguage, value: en.admin.languageArabic },
    ]);
    expect(changes('setting', { key: 'workspace.wallpaper', value: 'jade' }, 'ar')).toEqual([
      { label: ar.admin.wallpaper, value: ar.admin.wallpaper_jade },
    ]);
    expect(changes('setting', { key: 'retention.trash_days', value: 45 })).toEqual([
      { label: en.admin.settingsTrashDays, value: '45' },
    ]);
    expect(changes('setting', { key: 'workspace.principal_person_id', value: 'abc' })).toEqual([
      { label: en.admin.settingsPrincipal, value: en.admin.auditChanged },
    ]);
    expect(changes('setting', { key: 'unknown.key', value: 1 })).toEqual([]);
  });
  it('ADMIN-B47 choosing an uploaded wallpaper reads as "Your image", not its id', () => {
    expect(
      changes(
        'setting',
        { key: 'workspace.wallpaper', value: '0199f000-0000-7000-8000-000000000001' },
        'ar',
      ),
    ).toEqual([{ label: ar.admin.wallpaper, value: ar.admin.wallpaper_custom }]);
  });
  it('ADMIN-B43 task states and priorities read as words, ISO dates as formatted dates', () => {
    expect(
      changes('task', {
        status: 'waiting_on',
        priority: 'urgent',
        dueDate: '2026-09-12',
        completedAt: '2026-09-12T15:00:00.000Z',
      }),
    ).toEqual([
      { label: en.admin.auditField_status, value: en.tasks.waiting_on },
      { label: en.admin.auditField_priority, value: en.tasks.urgent },
      { label: en.admin.auditField_dueDate, value: 'Sep 12, 2026' },
      {
        label: en.admin.auditField_completedAt,
        value: expect.stringMatching(/^Sep 12, 2026.*3:00/u),
      },
    ]);
    expect(changes('task', { status: 'waiting_on' }, 'ar')).toEqual([
      { label: ar.admin.auditField_status, value: ar.tasks.waiting_on },
    ]);
  });
  it('ADMIN-B43 long text reads as edited, references as changed, empties as cleared, booleans as Yes or No', () => {
    expect(
      changes('note', {
        content: 'A long body that is never quoted in the history',
        ownerId: '0190a1b2-0000-7000-8000-000000000000',
        title: '',
        isAssignable: true,
      }),
    ).toEqual([
      { label: en.admin.auditField_content, value: en.admin.auditEdited },
      { label: en.admin.auditField_ownerId, value: en.admin.auditChanged },
      { label: en.admin.auditField_title, value: en.admin.auditCleared },
      { label: en.admin.auditField_isAssignable, value: en.admin.auditYes },
    ]);
  });
  it('ADMIN-B43 unknown fields are left out and at most five changes are shown', () => {
    expect(changes('task', { position: 3, revision: 4, id: 'x', title: 'Kept' })).toEqual([
      { label: en.admin.auditField_title, value: 'Kept' },
    ]);
    const many = changes('person', {
      fullName: 'A',
      displayName: 'B',
      honorific: 'C',
      organization: 'D',
      roleTitle: 'E',
      email: 'f@example.test',
      phone: '1',
    });
    expect(many).toHaveLength(5);
    expect(changes('task', 'not a record')).toEqual([]);
  });
});
describe('ADMIN-B43 audit list', () => {
  const rows = [
    {
      id: '1',
      action: 'update',
      entityType: 'note',
      actorName: 'Huda Admin',
      createdAt: '2026-09-10T08:00:00Z',
      diff: { title: 'Board minutes' },
    },
    {
      id: '2',
      action: 'reorder',
      entityType: 'task',
      actorName: 'Huda Admin',
      createdAt: '2026-09-10T07:00:00Z',
    },
    {
      id: '3',
      action: 'reorder',
      entityType: 'task',
      actorName: 'Huda Admin',
      createdAt: '2026-09-10T06:59:00Z',
    },
    {
      id: '4',
      action: 'reorder',
      entityType: 'task',
      actorName: 'Huda Admin',
      createdAt: '2026-09-10T06:58:00Z',
    },
    {
      id: '5',
      action: 'create',
      entityType: 'backup',
      actorName: null,
      createdAt: '2026-09-09T02:00:00Z',
    },
    {
      id: '6',
      action: 'delete',
      entityType: 'task',
      actorName: 'Huda Admin',
      createdAt: '2026-09-01T10:00:00Z',
    },
    {
      id: '7',
      action: 'some.new_action',
      entityType: 'fresh_kind',
      createdAt: '2026-09-01T09:00:00Z',
    },
  ];
  it.each(['en', 'ar'] as const)(
    'ADMIN-B43 entries group by day, consecutive reorders merge with a count, and the actor or System is named %s',
    (locale) => {
      const m = locale === 'ar' ? ar : en;
      mount(<AuditList rows={rows} />, locale);
      const sections = screen.getAllByRole('region');
      expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
        m.admin.auditToday,
        m.admin.auditYesterday,
        locale === 'en' ? 'Sep 1, 2026' : expect.any(String),
      ]);
      const today = within(sections[0]!)
        .getAllByRole('listitem')
        .filter((item) => item.closest('ul')?.parentElement === sections[0]);
      expect(today).toHaveLength(2);
      expect(today[0]?.textContent).toContain(
        `${m.admin.auditAction_update} ${m.admin.auditEntity_note}`,
      );
      expect(today[0]?.textContent).toContain('Board minutes');
      expect(today[0]?.textContent).toContain('Huda Admin');
      const merged = m.admin.auditEventMany
        .replace('{action}', m.admin.auditAction_reorder)
        .replace('{entity}', m.admin.auditEntity_task)
        .replace('{count, number, integer}', '3');
      expect(today[1]?.textContent).toContain(merged);
      expect(within(sections[1]!).getByText(m.admin.auditSystem)).toBeTruthy();
      expect(within(sections[2]!).getByText(/some new action fresh kind/u)).toBeTruthy();
    },
  );
});
