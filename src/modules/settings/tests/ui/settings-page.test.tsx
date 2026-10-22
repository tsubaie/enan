// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import { routes } from '@/core/routes';
import type { z } from 'zod';
import { Setting as SettingSchema } from '../../schema/validation';
import { SettingsPage } from '../../ui/SettingsPage';
import { NumberSetting, TextSetting } from '../../ui/SettingControls';
import { mount } from './harness';
// ADMIN-B07: the page is drawn from the registry's rows. The query hooks are the only seam, so
// each scenario hands the rows in and watches what the controls ask to write.
type Setting = z.infer<typeof SettingSchema>;
const state = vi.hoisted(() => ({
  query: {} as {
    isPending: boolean;
    error: Error | null;
    data?: { data: Setting[] };
    refetch?: () => void;
  },
  save: { mutate: vi.fn(), error: null as Error | null, variables: undefined },
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('../../ui/queries', () => ({
  useSettings: () => state.query,
  useSaveSetting: () => state.save,
  usePersonChoices: () => ({ data: { data: [] } }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock('@/ui/primitives/toast', () => ({ useToastManager: () => ({ add: state.toast }) }));
const name: Setting = {
  key: 'workspace.name',
  value: 'E2E Office',
  default: 'Enan',
  type: 'string',
};
const days: Setting = { key: 'retention.trash_days', value: 30, default: 30, type: 'number' };
const backups: Setting = { key: 'retention.backup_count', value: 7, default: 14, type: 'number' };
const view: Setting = {
  key: 'tasks.default_view',
  value: 'next_action',
  default: 'next_action',
  type: 'string',
};
const thresholds: Setting = {
  key: 'kpis.status_thresholds',
  value: { higher: { on: 0.9, near: 0.5 }, lower: { on: 1.01, near: 1.18 } },
  default: { higher: { on: 0.99, near: 0.85 }, lower: { on: 1.01, near: 1.18 } },
  type: 'object',
};
beforeEach(() => {
  state.save = { mutate: vi.fn(), error: null, variables: undefined };
  state.refresh = vi.fn();
  state.toast = vi.fn();
  state.query = {
    isPending: false,
    error: null,
    data: { data: [name, days, backups, view, thresholds] },
  };
});
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const lastSave = () => state.save.mutate.mock.lastCall?.[0];
describe.each(['en', 'ar'] as const)('%s', (locale) => {
  const m = locale === 'ar' ? ar : en;
  it(`ADMIN-B07 the page keeps to the workspace and retention and links to the pages that own the rest ${locale}`, () => {
    mount(<SettingsPage />, locale);
    expect(screen.getByText(m.admin.settingsDescription)).toBeTruthy();
    expect(input(m.admin.settingsName).value).toBe('E2E Office');
    expect(input(m.admin.settingsTrashDays).value).toBe('30');
    expect(screen.getAllByText(m.admin.unitDays).length).toBeGreaterThan(0);
    // The task view and the KPI thresholds now live on their own admin pages.
    expect(screen.queryByLabelText(m.admin.settingsDefaultView)).toBeNull();
    expect(screen.queryByText(m.admin.settingsKpis)).toBeNull();
    expect(screen.getByText(m.admin.settingsElsewhere)).toBeTruthy();
    for (const [page, label] of [
      ['tasks', m.admin.tasks],
      ['objectives', m.admin.objectives],
      ['ai', m.admin.ai],
      ['notes', m.admin.notes],
    ] as const)
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(
        routes.admin(page),
      );
  });
  it(`ADMIN-B07 a reset control appears only on a row that differs from its default, and writes the default ${locale}`, () => {
    mount(<SettingsPage />, locale);
    const reset = (label: string) =>
      screen.queryByRole('button', { name: m.admin.resetNamed.replace('{name}', label) });
    expect(reset(m.admin.settingsTrashDays)).toBeNull();
    expect(reset(m.admin.settingsName)).toBeTruthy();
    fireEvent.click(reset(m.admin.settingsBackupCount)!);
    expect(lastSave()).toEqual({ key: 'retention.backup_count', value: 14 });
  });
  it(`ADMIN-B48 each retention row says under its field what 0 means, and at 0 says never in words ${locale}`, () => {
    state.query = {
      isPending: false,
      error: null,
      data: {
        data: [
          name,
          { ...days, value: 0 },
          { key: 'retention.meeting_files_days', value: 365, default: 365, type: 'number' },
          { ...backups, value: 0 },
        ],
      },
    };
    mount(<SettingsPage />, locale);
    const zero = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(0);
    const rows = [
      [m.admin.settingsTrashDays, m.admin.settingsTrashHint],
      [m.admin.settingsFilesDays, m.admin.settingsFilesHint],
      [m.admin.settingsBackupCount, m.admin.settingsBackupsHint],
    ] as const;
    for (const [label, hint] of rows) {
      const field = input(label);
      const described = field.getAttribute('aria-describedby');
      expect(described).toBeTruthy();
      expect(document.getElementById(described!)?.textContent).toBe(
        hint.replace('{zero, number, integer}', zero),
      );
    }
    expect(input(m.admin.settingsTrashDays).value).toBe('0');
    const unitOf = (label: string) =>
      input(label).parentElement?.querySelector(':scope > span')?.textContent;
    expect(unitOf(m.admin.settingsTrashDays)).toBe(m.admin.settingsTrashNever);
    expect(unitOf(m.admin.settingsBackupCount)).toBe(m.admin.settingsBackupsNever);
    expect(unitOf(m.admin.settingsFilesDays)).toBe(m.admin.unitDays);
    // Typing 0 into a field says never at once, before it is saved.
    fireEvent.change(input(m.admin.settingsFilesDays), { target: { value: '0' } });
    expect(unitOf(m.admin.settingsFilesDays)).toBe(m.admin.settingsFilesNever);
  });
});
describe('ADMIN-B07 controls save on blur', () => {
  it('ADMIN-B07 a text setting saves the trimmed value on blur only when it changed and is not empty', () => {
    const save = vi.fn();
    mount(<TextSetting setting={name} save={save} label="Name" />);
    fireEvent.blur(input('Name'));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input('Name'), { target: { value: '   ' } });
    fireEvent.blur(input('Name'));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input('Name'), { target: { value: '  Renamed Office ' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.blur(input('Name'));
    expect(save).toHaveBeenCalledExactlyOnceWith({
      key: 'workspace.name',
      value: 'Renamed Office',
    });
  });
  it('ADMIN-B07 ADMIN-B48 a number setting saves a whole number in range, 0 included, on blur and puts back anything else', () => {
    const save = vi.fn();
    mount(
      <NumberSetting setting={days} save={save} label="Trash" unit="days" min={0} max={3650} />,
    );
    expect(input('Trash').getAttribute('dir')).toBe('ltr');
    expect(screen.getByText('days')).toBeTruthy();
    expect(input('Trash').getAttribute('aria-describedby')).toBeNull();
    fireEvent.blur(input('Trash'));
    for (const bad of ['-1', '4000', '2.5', '', ' ']) {
      fireEvent.change(input('Trash'), { target: { value: bad } });
      fireEvent.blur(input('Trash'));
      expect(input('Trash').value).toBe('30');
    }
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input('Trash'), { target: { value: '45' } });
    fireEvent.blur(input('Trash'));
    expect(save).toHaveBeenCalledExactlyOnceWith({ key: 'retention.trash_days', value: 45 });
    fireEvent.change(input('Trash'), { target: { value: '0' } });
    fireEvent.blur(input('Trash'));
    expect(save).toHaveBeenLastCalledWith({ key: 'retention.trash_days', value: 0 });
  });
  it('ADMIN-B07 a saved change is confirmed by a toast and a rendered setting refreshes the page', () => {
    state.save.mutate = vi.fn((_input, options: { onSuccess: () => void }) => options.onSuccess());
    mount(<SettingsPage />);
    fireEvent.change(input(en.admin.settingsName), { target: { value: 'Renamed Office' } });
    fireEvent.blur(input(en.admin.settingsName));
    expect(state.toast).toHaveBeenCalledWith({ title: en.common.saved });
    // The workspace name is shown beside the logo in the side menu, so saving it re-renders.
    expect(state.refresh).toHaveBeenCalledTimes(1);
    // A setting nothing on the page renders from the server is saved without a refresh.
    fireEvent.change(input(en.admin.settingsTrashDays), { target: { value: '45' } });
    fireEvent.blur(input(en.admin.settingsTrashDays));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.toast).toHaveBeenCalledTimes(2);
  });
});
it('ADMIN-B07 a refused write is shown above the sections', () => {
  state.save = {
    ...state.save,
    error: new ApiError('validation_failed', 'Check the entered values.', {}, 'req-1'),
  };
  mount(<SettingsPage />);
  expect(screen.getAllByRole('alert')[0]?.textContent).toContain('Check the entered values.');
});
it('ADMIN-B07 the page waits on its query and reports a failed one', () => {
  state.query = { isPending: true, error: null };
  mount(<SettingsPage />);
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByLabelText(en.admin.settingsName)).toBeNull();
  state.query = {
    isPending: false,
    error: new ApiError('forbidden', 'This action is not allowed.', { reason: 'role' }, 'req-2'),
    refetch: vi.fn(),
  };
  mount(<SettingsPage />);
  expect(screen.getByRole('alert').textContent).toContain('This action is not allowed.');
});
