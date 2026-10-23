// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { defaults } from '@/core/config/defaults';
import { UpdatesPage } from '../../ui/UpdatesPage';
import { mount } from './harness';
import { extremeZones } from '../../../../../tests/fixtures/timezones';

const state = vi.hoisted(() => ({
  updates: {} as object,
  command: {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    data: undefined as { data: { command: string } } | undefined,
  },
}));
vi.mock('../../ui/update-queries', async (original) => ({
  ...(await original<typeof import('../../ui/update-queries')>()),
  useUpdates: () => ({ isPending: false, error: null, data: { data: state.updates } }),
  useCommand: () => state.command,
}));
// The harness's clock is 2026-09-10T09:00:00Z.
const status = (fields: object = {}) => ({
  channel: 'latest',
  state: 'checked',
  running: { version: '1.1.0', revision: 'abcdef1234567' },
  lastCheckAt: '2026-09-10T08:55:00Z',
  paused: false,
  automatic: false,
  confirm: false,
  timeZone: extremeZones.east,
  intervalSeconds: 900,
  ...fields,
});
const digest = `sha256:${'a'.repeat(64)}`;
function show(health: string, current: object | null, history: object[] = [], commands = true) {
  state.updates = { health, status: current, history, commands };
}
beforeEach(() => {
  state.command = {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null,
    data: undefined,
  };
});

it('ADMIN-B57 without the updater the page says nothing is announced and how to start it', () => {
  show('not_running', null);
  mount(<UpdatesPage />);
  expect(screen.getByRole('heading', { name: en.admin.updaterNotRunning })).toBeTruthy();
  expect(screen.getByText('docker compose up -d updater')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: en.admin.updateCheckNow })).toBeNull();
});

it('ADMIN-B57 a running updater shows the version, channel, last check and result', () => {
  show('running', status());
  mount(<UpdatesPage />);
  expect(screen.getByText('1.1.0')).toBeTruthy();
  expect(screen.getByText('(abcdef1)')).toBeTruthy();
  expect(screen.getByText('latest')).toBeTruthy();
  expect(screen.getByText(en.admin.updateState_checked)).toBeTruthy();
  const notes = screen.getByRole('link', { name: new RegExp(en.admin.updateReleaseNotes) });
  expect(notes.getAttribute('href')).toBe(`${defaults.releaseNotes}1.1.0`);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('ADMIN-B57 a stalled updater is raised as an alert with where to look', () => {
  show('stalled', status({ lastCheckAt: '2026-09-10T07:00:00Z' }));
  mount(<UpdatesPage />);
  expect(screen.getByRole('alert').textContent).toContain(en.admin.updaterStalled);
  expect(screen.getByText('docker compose logs updater')).toBeTruthy();
});

it('ADMIN-B57 a rolled back update names the step, the error, the backup and how to restore it', () => {
  const rolledBack = status({
    state: 'rolled_back',
    step: 'verify',
    error: 'not healthy within 3m0s',
    candidate: { version: '1.2.0', revision: '9999999aaaaaa' },
    backup: 'b-1',
    restoreCommand:
      'docker compose exec app pnpm backup:restore /var/lib/enan/backups/b-1 --confirm',
    log: 'Error: boom',
  });
  show('running', rolledBack, [rolledBack]);
  mount(<UpdatesPage />);
  expect(screen.getByRole('heading', { name: en.admin.updateOutcomeRolledBack })).toBeTruthy();
  // In the outcome and in the history line below it.
  expect(screen.getAllByText('not healthy within 3m0s')).toHaveLength(2);
  expect(
    screen.getByText(
      'docker compose exec app pnpm backup:restore /var/lib/enan/backups/b-1 --confirm',
    ),
  ).toBeTruthy();
  expect(screen.getByText('Error: boom')).toBeTruthy();
  expect(screen.getByRole('heading', { name: en.admin.updateHistory })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en.admin.updateRetry }));
  expect(state.command.mutate).toHaveBeenCalledWith({ command: 'retry' });
});

it('ADMIN-B58 Check now and Pause send their commands; a paused updater offers Resume', () => {
  show('running', status());
  mount(<UpdatesPage />);
  fireEvent.click(screen.getByRole('button', { name: en.admin.updateCheckNow }));
  fireEvent.click(screen.getByRole('button', { name: en.admin.updatePause }));
  expect(state.command.mutate.mock.calls).toEqual([[{ command: 'check' }], [{ command: 'pause' }]]);
  show('running', status({ paused: true }));
  mount(<UpdatesPage />);
  expect(screen.getByText(en.admin.updateState_paused)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: en.admin.updateCheckNow }).hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: en.admin.updateResume }));
  expect(state.command.mutate).toHaveBeenLastCalledWith({ command: 'resume' });
});

it('ADMIN-B58 without a writable commands folder the controls are off and say why', () => {
  show('running', status(), [], false);
  mount(<UpdatesPage />);
  expect(screen.getByText(en.admin.updateCommandsUnavailable)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: en.admin.updateCheckNow }).hasAttribute('disabled'),
  ).toBe(true);
});

it('ADMIN-B57 the page reads in Arabic, with versions and commands kept left to right', () => {
  const blocked = status({
    state: 'blocked',
    step: 'guard',
    error:
      '2027.1.0 cannot read migration 9 of the running 2026.12.0 (ADR 0050); restore a backup taken before it instead',
    candidate: { version: '2027.1.0' },
  });
  show('running', blocked, [blocked]);
  mount(<UpdatesPage />, 'ar');
  expect(screen.getByRole('heading', { name: ar.admin.updatesTitle })).toBeTruthy();
  expect(screen.getByRole('heading', { name: ar.admin.updateOutcomeBlocked })).toBeTruthy();
  expect(screen.getAllByText('2027.1.0')[0]?.closest('bdi')?.getAttribute('dir')).toBe('ltr');
  // Held back for the operator: trying again would change nothing.
  expect(screen.queryByRole('button', { name: ar.admin.updateRetry })).toBeNull();
});

it('ADMIN-B57 the backup and restore command stay on the page after the next check, until an update succeeds', () => {
  const rolledBack = status({
    state: 'rolled_back',
    step: 'verify',
    error: 'the container stopped',
    candidate: { version: '1.2.0' },
    backup: 'b-2',
    restoreCommand:
      'docker compose exec app pnpm backup:restore /var/lib/enan/backups/b-2 --confirm',
  });
  // The updater's next check holds the failed image back and overwrites its status.
  const heldAgain = status({
    state: 'blocked',
    step: 'check',
    candidate: { digest: 'sha256:abc' },
    error: 'this image failed before',
  });
  show('running', heldAgain, [heldAgain, rolledBack]);
  mount(<UpdatesPage />);
  expect(screen.getByRole('heading', { name: en.admin.updateOutcomeRolledBack })).toBeTruthy();
  expect(
    screen.getByText(
      'docker compose exec app pnpm backup:restore /var/lib/enan/backups/b-2 --confirm',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: en.admin.updateRetry })).toBeTruthy();
  // The hold repeats the failure, so the history lists only the failure.
  expect(screen.queryByText('this image failed before')).toBeNull();
  const installed = status({ state: 'updated', running: { version: '1.3.0' } });
  show('running', installed, [installed, rolledBack]);
  mount(<UpdatesPage />);
  expect(screen.queryByRole('heading', { name: en.admin.updateOutcomeRolledBack })).toBeNull();
});

it('ADMIN-B67 a release the updater announced waits for Install now, which sends exactly its digest', () => {
  show('running', status({ state: 'available', candidate: { version: '2026.11.0', digest } }));
  mount(<UpdatesPage />);
  expect(screen.getByRole('heading', { name: en.admin.updateAvailableTitle })).toBeTruthy();
  expect(screen.getByText(en.admin.updateState_available)).toBeTruthy();
  const notes = screen.getAllByRole('link', { name: new RegExp(en.admin.updateReleaseNotes) });
  expect(notes.map((link) => link.getAttribute('href'))).toContain(
    `${defaults.releaseNotes}2026.11.0`,
  );
  fireEvent.click(screen.getByRole('button', { name: en.admin.updateInstallNow }));
  expect(state.command.mutate).toHaveBeenCalledWith(
    { command: 'install', digest, confirm: false },
    expect.anything(),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  // A paused updater installs nothing, so the page does not offer it.
  show('running', status({ state: 'available', paused: true, candidate: { digest } }));
  mount(<UpdatesPage />);
  const buttons = screen.getAllByRole('button', { name: en.admin.updateInstallNow });
  expect(buttons.at(-1)?.hasAttribute('disabled')).toBe(true);
});

it('ADMIN-B67 a release the running one cannot go back from is installed only after a confirmation that says so (ar)', () => {
  show(
    'running',
    status({ state: 'available', confirm: true, candidate: { version: '2027.1.0', digest } }),
  );
  mount(<UpdatesPage />, 'ar');
  expect(screen.getByText(ar.admin.updateAvailableContract)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: ar.admin.updateInstallNow }));
  expect(state.command.mutate).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain(ar.admin.updateConfirmTitle);
  expect(dialog.textContent).toContain(ar.admin.updateConfirmBody);
  fireEvent.click(screen.getByRole('button', { name: ar.admin.updateConfirmInstall }));
  expect(state.command.mutate).toHaveBeenCalledWith(
    { command: 'install', digest, confirm: true },
    expect.anything(),
  );
});

it('ADMIN-B67 an install under way shows the step it is at', () => {
  show(
    'running',
    status({ state: 'updating', step: 'switch', candidate: { version: '2026.11.0' } }),
  );
  mount(<UpdatesPage />);
  expect(screen.getByRole('heading', { name: en.admin.updateInstalling })).toBeTruthy();
  expect(screen.getByText(en.admin.updateProgress_switch).getAttribute('aria-current')).toBe(
    'step',
  );
  expect(screen.getByText(en.admin.updateProgress_backup).getAttribute('aria-current')).toBeNull();
});

it('ADMIN-B68 automatic installing is off by default and saved with its window', () => {
  show('running', status());
  mount(<UpdatesPage />);
  const toggle = screen.getByRole('checkbox', { name: new RegExp(en.admin.updateAutomatic) });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByText(en.admin.updateWindow.replace('{zone}', extremeZones.east))).toBeTruthy();
  fireEvent.click(toggle);
  const save = screen.getByRole('button', { name: en.admin.updateAutomaticSave });
  fireEvent.change(screen.getByLabelText(en.admin.updateWindowFrom), {
    target: { value: '02:00' },
  });
  // Half a window is no window.
  expect(save.hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText(en.admin.updateWindowTo), { target: { value: '05:00' } });
  fireEvent.click(save);
  expect(state.command.mutate).toHaveBeenCalledWith({
    command: 'settings',
    automatic: true,
    window: '02:00-05:00',
  });
});

it('ADMIN-B68 the page shows the setting the updater recorded, and reads in Arabic', () => {
  show('running', status({ automatic: true, window: '23:00-04:00' }));
  mount(<UpdatesPage />, 'ar');
  const toggle = screen.getByRole('checkbox', { name: new RegExp(ar.admin.updateAutomatic) });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByLabelText(ar.admin.updateWindowFrom)).toHaveProperty('value', '23:00');
  expect(screen.getByLabelText(ar.admin.updateWindowTo)).toHaveProperty('value', '04:00');
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: ar.admin.updateAutomaticSave }));
  expect(state.command.mutate).toHaveBeenCalledWith({
    command: 'settings',
    automatic: false,
    window: '23:00-04:00',
  });
});
