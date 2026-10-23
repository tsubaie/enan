// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { defaults } from '@/core/config/defaults';
import { UpdatesPage } from '../../ui/UpdatesPage';
import { mount } from './harness';

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
  intervalSeconds: 900,
  ...fields,
});
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

it('ADMIN-B57 without the updater the page says updates are by hand and how to turn them on', () => {
  show('not_running', null);
  mount(<UpdatesPage />);
  expect(screen.getByRole('heading', { name: en.admin.updaterNotRunning })).toBeTruthy();
  expect(screen.getByText('docker compose --profile autoupdate up -d')).toBeTruthy();
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
  expect(state.command.mutate).toHaveBeenCalledWith('retry');
});

it('ADMIN-B58 Check now and Pause send their commands; a paused updater offers Resume', () => {
  show('running', status());
  mount(<UpdatesPage />);
  fireEvent.click(screen.getByRole('button', { name: en.admin.updateCheckNow }));
  fireEvent.click(screen.getByRole('button', { name: en.admin.updatePause }));
  expect(state.command.mutate.mock.calls).toEqual([['check'], ['pause']]);
  show('running', status({ paused: true }));
  mount(<UpdatesPage />);
  expect(screen.getByText(en.admin.updateState_paused)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: en.admin.updateCheckNow }).hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: en.admin.updateResume }));
  expect(state.command.mutate).toHaveBeenLastCalledWith('resume');
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
      'migration 9 of 2027.1.0 cannot be undone by going back to 2026.12.0 (ADR 0050); back up, then set ENAN_ALLOW_CONTRACT=true to install it',
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
