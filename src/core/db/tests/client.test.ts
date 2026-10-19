import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { count, sql } from 'drizzle-orm';
import { env } from '@/core/config/env';
import {
  DatabaseBusyError,
  busyRetryWindowMs,
  busyTimeoutMs,
  closeDatabase,
  concurrency,
  databaseFor,
  db,
  openClient,
  pool,
  withTransaction,
} from '../client';
import { migrateDatabase } from '../migrate';
import { clearDatabase } from '../reset';
import { id } from '../ids';
import { users } from '../system-schema';
const user = (email: string) => ({ id: id(), email, name: 'U', passwordHash: 'x', role: 'admin' });
const userCount = async () => (await db().select({ n: count() }).from(users))[0]?.n ?? 0;
beforeAll(async () => {
  await migrateDatabase();
});
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
describe('immediate transactions behind the write queue (ADR 0029)', () => {
  it('a second transaction waits for the first to commit instead of failing with SQLITE_BUSY', async () => {
    let firstCommitted = 0;
    let secondStarted = 0;
    const first = withTransaction(db(), async (tx) => {
      await tx.insert(users).values(user('first@example.test'));
      await sleep(120);
      firstCommitted = Date.now();
    });
    await sleep(10);
    const second = withTransaction(db(), async (tx) => {
      secondStarted = Date.now();
      await tx.insert(users).values(user('second@example.test'));
    });
    await Promise.all([first, second]);
    expect(secondStarted).toBeGreaterThanOrEqual(firstCommitted);
    expect(await userCount()).toBe(2);
  });
  it('gives up with a clear error once the retry window has passed, and the holder still commits', async () => {
    const holder = withTransaction(db(), async (tx) => {
      await tx.insert(users).values(user('holder@example.test'));
      await sleep(250);
    });
    await sleep(10);
    await expect(
      withTransaction(db(), async () => 'never', { windowMs: 60 }),
    ).rejects.toBeInstanceOf(DatabaseBusyError);
    await holder;
    expect(await userCount()).toBe(1);
  });
  it('a pool transaction requested inside a running one is refused at once, not after the window', async () => {
    const started = Date.now();
    await expect(
      withTransaction(db(), async () => withTransaction(db(), async () => 'nested')),
    ).rejects.toThrow(/inside an open transaction/u);
    expect(Date.now() - started).toBeLessThan(busyRetryWindowMs);
  });
  it('a lock held by another connection past the busy wait fails cleanly and the pool recovers', async () => {
    const other = openClient(env().DATABASE_URL, 1);
    try {
      await other.primed;
      const lock = await other.transaction('write');
      const started = Date.now();
      await expect(withTransaction(db(), async () => 'never')).rejects.toBeInstanceOf(
        DatabaseBusyError,
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(busyTimeoutMs - 50);
      await lock.rollback();
      // The connection whose BEGIN was refused would fail every later commit; the pool was reopened.
      for (let round = 0; round < concurrency; round += 1)
        await withTransaction(db(), async (tx) => {
          await tx.insert(users).values(user(`round${round}@example.test`));
        });
      expect(await userCount()).toBe(concurrency);
    } finally {
      other.close();
    }
  }, 15_000);
  it('a SQLITE_BUSY raised by the work itself is not retried: the work ran once', async () => {
    let runs = 0;
    await expect(
      withTransaction(db(), async () => {
        runs += 1;
        throw Object.assign(new Error('busy inside'), { code: 'SQLITE_BUSY' });
      }),
    ).rejects.toThrow('busy inside');
    expect(runs).toBe(1);
  });
  it('a nested transaction is a savepoint: its failure rolls back only its own writes', async () => {
    await withTransaction(db(), async (tx) => {
      await tx.insert(users).values(user('outer@example.test'));
      await expect(
        tx.transaction(async (inner) => {
          await inner.insert(users).values(user('inner@example.test'));
          throw new Error('inner failed');
        }),
      ).rejects.toThrow('inner failed');
      await tx.insert(users).values(user('after@example.test'));
    });
    const emails = (await db().select({ email: users.email }).from(users)).map((r) => r.email);
    expect(emails.sort()).toEqual(['after@example.test', 'outer@example.test']);
  });
  it('a throw rolls the whole transaction back', async () => {
    await expect(
      withTransaction(db(), async (tx) => {
        await tx.insert(users).values(user('gone@example.test'));
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await userCount()).toBe(0);
  });
});
describe('connection pool settings', () => {
  it('every pooled connection of a fresh client enforces foreign keys', async () => {
    const fresh = openClient(env().DATABASE_URL);
    try {
      const violation = {
        sql: 'insert into sessions (id, user_id, token_hash, issued_at, last_seen_at, expires_at, absolute_expires_at) values (?, ?, ?, 0, 0, 0, 0)',
        args: [id(), id(), id()],
      };
      // Issued synchronously, each call borrows a distinct pooled connection.
      const attempts = Array.from({ length: concurrency }, () => fresh.execute(violation));
      const outcomes = await Promise.allSettled(attempts);
      expect(outcomes).toHaveLength(concurrency);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected')
          expect(outcome.reason).toMatchObject({
            code: 'SQLITE_CONSTRAINT',
            message: expect.stringMatching(/FOREIGN KEY/u),
          });
      }
      const flags = await Promise.all(
        Array.from({ length: concurrency }, () =>
          fresh.execute('pragma foreign_keys').then((result) => result.rows[0]?.foreign_keys),
        ),
      );
      expect(flags).toEqual(Array.from({ length: concurrency }, () => 1));
      expect(await databaseFor(fresh).all(sql`select count(*) as n from sessions`)).toEqual([
        { n: 0 },
      ]);
    } finally {
      fresh.close();
    }
  });
  it('the file is in WAL mode with normal synchronous writes and a short busy wait for other processes', async () => {
    await pool().primed;
    expect(await db().get(sql`pragma journal_mode`)).toEqual({ journal_mode: 'wal' });
    expect(await db().get(sql`pragma synchronous`)).toEqual({ synchronous: 1 });
    expect(await db().get(sql`pragma busy_timeout`)).toEqual({ timeout: busyTimeoutMs });
  });
  it('closeDatabase forgets the client so the next call opens the file again (restore swaps it)', async () => {
    const before = pool();
    closeDatabase();
    expect(before.closed).toBe(true);
    const after = pool();
    expect(after).not.toBe(before);
    expect(await db().get(sql`select 1 as one`)).toEqual({ one: 1 });
  });
});
