import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandsLeft,
  folders,
  readOnly,
  removeAll,
  removeCommands,
  reset,
  writable,
  type Folders,
} from './fixtures';

const config = vi.hoisted(() => ({ UPDATER_STATUS_DIR: '', UPDATER_COMMANDS_DIR: '' }));
vi.mock('@/core/config/env', () => ({ env: () => config }));
const { healthOf, parseHistory, queueCommand, readUpdates, UpdaterStatus } =
  await import('../updater');

const now = new Date('2026-10-22T12:00:00Z');
const status = (fields: object = {}) =>
  JSON.stringify({
    channel: 'latest',
    state: 'checked',
    intervalSeconds: 900,
    lastCheckAt: '2026-10-22T11:55:00Z',
    paused: false,
    ...fields,
  });
let dirs: Folders;
beforeEach(async () => {
  dirs = await folders();
  config.UPDATER_STATUS_DIR = dirs.status;
  config.UPDATER_COMMANDS_DIR = dirs.commands;
  await reset(dirs);
});
afterEach(() => removeAll(dirs));

describe('the updater as Enan reads it', () => {
  it('ADMIN-B57 no status file means the updater is not running', async () => {
    expect(await readUpdates(now)).toEqual({
      health: 'not_running',
      status: null,
      history: [],
      commands: true,
    });
  });
  it('ADMIN-B57 a status file that does not parse is reported as unreadable, not as running', async () => {
    for (const text of ['{"state":', '{"channel":"latest"}', '[]']) {
      await reset(dirs, text);
      expect(await readUpdates(now)).toMatchObject({ health: 'unreadable', status: null });
    }
  });
  it('ADMIN-B57 the updater is stalled after three intervals and five minutes without a check', () => {
    const at = (lastCheckAt: string | undefined) =>
      healthOf(UpdaterStatus.parse(JSON.parse(status({ lastCheckAt }))), now);
    expect(at('2026-10-22T11:55:00Z')).toBe('running');
    // 900 s × 3 + 5 min = 50 min.
    expect(at('2026-10-22T11:10:01Z')).toBe('running');
    expect(at('2026-10-22T11:09:59Z')).toBe('stalled');
    expect(at(undefined)).toBe('stalled');
    expect(healthOf(null, now)).toBe('not_running');
  });
  it('ADMIN-B57 the history reads newest first and skips a line cut short', async () => {
    const lines = [
      status({ state: 'updated', finishedAt: '2026-10-22T10:00:00Z' }),
      '{"state": "rolled_b',
      status({ state: 'rolled_back', finishedAt: '2026-10-22T11:00:00Z' }),
    ];
    await reset(dirs, status(), lines.join('\n') + '\n');
    const updates = await readUpdates(now);
    expect(updates.health).toBe('running');
    expect(updates.history.map((entry) => entry.state)).toEqual(['rolled_back', 'updated']);
    expect(parseHistory(null)).toEqual([]);
  });
  it('ADMIN-B57 fields the page does not know are ignored, so a newer updater still reads', async () => {
    await reset(
      dirs,
      status({ somethingNew: { nested: true }, running: { version: '1.0.0', id: 'sha256:x' } }),
    );
    expect((await readUpdates(now)).status?.running).toEqual({ version: '1.0.0' });
  });
});

describe('commands for the updater', () => {
  it('ADMIN-B58 a command is one complete JSON file under a name the updater reads', async () => {
    await queueCommand({ command: 'pause' });
    await queueCommand({ command: 'check' });
    const { files, commands } = await commandsLeft(dirs);
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.endsWith('.json') && !file.startsWith('.'))).toBe(true);
    expect(commands.sort()).toEqual(['check', 'pause']);
  });
  it('ADMIN-B58 a commands folder Enan cannot write to is reported', async () => {
    await readOnly(dirs);
    try {
      // Root writes anywhere; the check is meaningful for the app's own user.
      expect((await readUpdates(now)).commands).toBe(process.getuid?.() === 0);
    } finally {
      await writable(dirs);
    }
    await removeCommands(dirs);
    expect((await readUpdates(now)).commands).toBe(false);
  });
});
