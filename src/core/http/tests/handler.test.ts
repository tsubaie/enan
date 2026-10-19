import { beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineHandler } from '../handler';
import { AppError } from '../errors';
import { DatabaseBusyError } from '@/core/db/client';
const session = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock('@/core/auth/session', () => session);
vi.mock('@/core/backup/maintenance', () => ({ isRestoring: async () => false }));
vi.mock('@/core/db/http-repo', () => ({
  maintenance: async () => false,
  replayRequest: vi.fn(),
  storeRequest: vi.fn(),
}));
// The busy error class stays real so the handler's instanceof check is the one under test.
vi.mock('@/core/db/client', async (original) => ({
  ...(await original<typeof import('@/core/db/client')>()),
  db: () => ({}),
  withTransaction: (_database: object, work: (database: object) => Promise<object>) => work({}),
}));
vi.mock('../origin', () => ({ checkOrigin: () => {} }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock('@/core/config/logger', () => ({ logger: log }));
beforeEach(() => session.currentUser.mockReset().mockResolvedValue(null));
const request = () =>
  new Request('http://localhost/api/v1/example', { method: 'POST', body: '{}' });
it('ADMIN-B37 a full queue answers 429 rate_limited with the queue scope and a Retry-After header', async () => {
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    enqueues: true,
    handler: async () => {
      throw new AppError('rate_limited', {
        scope: 'queue',
        kind: 'system.backup',
        retryAfterSeconds: 30,
      });
    },
  });
  const response = await route(request());
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('30');
  expect(await response.json()).toMatchObject({
    error: { code: 'rate_limited', details: { scope: 'queue', retryAfterSeconds: 30 } },
  });
  expect(route.meta.enqueues).toBe(true);
});
it('ADMIN-B37 an unexpected error stays a 500 without Retry-After', async () => {
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async () => {
      throw new Error('boom');
    },
  });
  const response = await route(request());
  expect(response.status).toBe(500);
  expect(response.headers.get('Retry-After')).toBeNull();
  expect(route.meta.enqueues).toBe(false);
});
it('ADMIN-B38 a request that waits out the database write lock answers 429 rate_limited and is logged as a warning, not a crash', async () => {
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async () => {
      throw new DatabaseBusyError(10, new Error('SQLITE_BUSY'));
    },
  });
  const response = await route(request());
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('1');
  expect(await response.json()).toMatchObject({
    error: { code: 'rate_limited', details: { scope: 'database', retryAfterSeconds: 1 } },
  });
  expect(log.warn).toHaveBeenCalledTimes(1);
  expect(log.error).not.toHaveBeenCalled();
});
it('ACCT-B09 API requests are the ones that slide the session', async () => {
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async () => ({}),
  });
  expect((await route(request())).status).toBe(200);
  expect(session.currentUser).toHaveBeenCalledWith({ slide: true });
});
it('ADMIN-B49 every API response says how long the origin spent on it, success and error alike', async () => {
  const ok = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async () => ({}),
  });
  const timing = (await ok(request())).headers.get('Server-Timing') ?? '';
  expect(timing).toMatch(/^auth;dur=\d+\.\d, db;dur=\d+\.\d, total;dur=\d+\.\d$/u);
  const refused = defineHandler({
    guard: 'session',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async () => ({}),
  });
  const response = await refused(request());
  expect(response.status).toBe(401);
  expect(response.headers.get('Server-Timing')).toMatch(/^auth;dur=\d+\.\d, total;dur=\d+\.\d$/u);
});
