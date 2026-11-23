import { beforeEach, expect, it, vi } from 'vitest';
import type { Context } from '@/core/auth/session';
import { transcriptionSwitchedOff } from '../admission';
// CAPTURES-B22: "switched off" is the workspace's choice (jobs, a provider key, the capability);
// a provider that is down is not, so the connection state is never what decides it.
const state = vi.hoisted(() => ({
  jobs: true,
  source: 'saved',
  enabled: ['notes.transcribe'],
  connection: 'enabled',
}));
vi.mock('@/core/config/env', () => ({ env: () => ({ JOBS_ENABLED: state.jobs }) }));
vi.mock('../credentials', () => ({ credentialStatus: async () => ({ source: state.source }) }));
vi.mock('../client', () => ({
  aiConnection: () => ({ state: state.connection, checkedAt: null }),
  checkConnection: vi.fn(),
}));
vi.mock('@/core/db/settings-repo', () => ({
  getSetting: async (_: object, key: string) =>
    key === 'ai.enabled_capabilities' ? state.enabled : null,
}));
const ctx = { db: {} } as Context;
beforeEach(() => {
  Object.assign(state, {
    jobs: true,
    source: 'saved',
    enabled: ['notes.transcribe'],
    connection: 'enabled',
  });
});
it.each([
  ['jobs disabled', { jobs: false }, true],
  ['no provider configured', { source: 'none' }, true],
  ['transcription not enabled', { enabled: ['captures.interpret'] }, true],
  ['a key from the environment', { source: 'environment' }, false],
  ['the provider failing', { connection: 'error' }, false],
  ['a connection not checked yet', { connection: 'disabled' }, false],
  ['everything on', {}, false],
])('CAPTURES-B22 transcription switched off with %s: %s', async (_, change, off) => {
  Object.assign(state, change);
  expect(await transcriptionSwitchedOff(ctx)).toBe(off);
});
