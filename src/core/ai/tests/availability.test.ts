import { beforeEach, expect, it, vi } from 'vitest';
import type { Context } from '@/core/auth/session';
import { availableCapabilities } from '../admission';
const connection = vi.hoisted(() => ({
  value: { state: 'disabled', checkedAt: null as string | null },
  check: vi.fn(),
}));
vi.mock('@/core/config/env', () => ({ env: () => ({ JOBS_ENABLED: true }) }));
vi.mock('../client', () => ({ aiConnection: () => connection.value, checkConnection: connection.check }));
vi.mock('../models', () => ({ loadModels: async () => [{ id: 'vendor/model', contextLength: 64000, maxOutputTokens: 16000 }] }));
vi.mock('@/core/db/settings-repo', () => ({ getSetting: async (_: object, key: string) =>
  key === 'ai.enabled_capabilities' ? ['notes.refine', 'notes.suggest_tags'] : 'vendor/model',
}));
beforeEach(() => {
  connection.value = { state: 'disabled', checkedAt: null };
  connection.check.mockReset();
  connection.check.mockImplementation(async () => {
    connection.value = { state: 'enabled', checkedAt: new Date().toISOString() };
    return connection.value;
  });
});
it('ADMIN-B25 initializes route-local connection status before exposing configured capabilities', async () => {
  // Only db is consumed by this read-only service; repositories are mocked at their boundary.
  const ctx = { db: {} } as Context;
  expect(await availableCapabilities(ctx)).toEqual(['notes.refine', 'notes.suggest_tags']);
  expect(connection.check).toHaveBeenCalledTimes(1);
  await availableCapabilities(ctx);
  expect(connection.check).toHaveBeenCalledTimes(1);
});
it('ADMIN-B25 refreshes stale connection status in the background so recovered AI actions reappear', async () => {
  connection.value = { state: 'error', checkedAt: new Date(Date.now() - 61000).toISOString() };
  let finish: () => void = () => {};
  connection.check.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => {
          connection.value = { state: 'enabled', checkedAt: new Date().toISOString() };
          resolve(connection.value);
        };
      }),
  );
  const ctx = { db: {} } as Context;
  // The provider call is still running: the answer uses the state already known, without waiting.
  expect(await availableCapabilities(ctx)).toEqual([]);
  expect(await availableCapabilities(ctx)).toEqual([]);
  expect(connection.check).toHaveBeenCalledTimes(1);
  finish();
  await Promise.resolve();
  expect(await availableCapabilities(ctx)).toContain('notes.refine');
});
