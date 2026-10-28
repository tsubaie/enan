import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { db, withTransaction, closeDatabase } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { jobs } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { defineHandler } from '../handler';
// ADR 0067 against the real file: a GET runs on the pool while a writer holds the lock, and the
// handle it runs on refuses a write unless a service opens its own queued transaction.
vi.mock('@/core/auth/session', () => ({ currentUser: async () => null }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/core/config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
const get = () => new Request('http://localhost/api/v1/jobs', { method: 'GET' });
const job = () => ({ id: id(), kind: 'system.backup', payload: {} });
const count = async () => (await db().select().from(jobs)).length;
it('ADR 0067 a GET is answered while another request holds the write lock', async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = withTransaction(db(), async (tx) => {
    await tx.insert(jobs).values(job());
    await held;
  });
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({ data: z.number() }),
    handler: async (_, ctx) => ({ data: (await ctx.db.select().from(jobs)).length }),
  });
  const response = await route(get());
  expect(response.status).toBe(200);
  // Its own snapshot: the holder's insert is not committed yet.
  expect(await response.json()).toEqual({ data: 0 });
  release();
  await holder;
  expect(await count()).toBe(1);
});
it('ADR 0067 a write on the pool from a GET is refused and stores nothing', async () => {
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async (_, ctx) => {
      await ctx.db.insert(jobs).values(job());
      return {};
    },
  });
  expect((await route(get())).status).toBe(500);
  expect(await count()).toBe(0);
});
it('ADR 0067 ADR 0054 a GET may still write through a service transaction of its own', async () => {
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async (_, ctx) => {
      await withTransaction(ctx.db, (tx) => tx.insert(jobs).values(job()));
      return {};
    },
  });
  expect((await route(get())).status).toBe(200);
  expect(await count()).toBe(1);
});
it('ADR 0067 a transaction opened directly on the read-only handle is refused and stores nothing', async () => {
  const route = defineHandler({
    guard: 'public',
    input: z.strictObject({}),
    response: z.object({}),
    handler: async (_, ctx) => {
      await ctx.db.transaction((tx) => tx.insert(jobs).values(job()));
      return {};
    },
  });
  expect((await route(get())).status).toBe(500);
  expect(await count()).toBe(0);
});
