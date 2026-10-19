import 'server-only';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, type Client } from '@libsql/client';
import { is } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { env } from '@/core/config/env';
import { logger } from '@/core/config/logger';
import { queryLogger } from './query-log';
import { databasePath, isTestDatabaseUrl } from './test-database';

/**
 * ADR 0029: one SQLite file behind a small pool of connections. Every client operation borrows a
 * connection for the call; a transaction holds one until it settles, so an open transaction never
 * shares a connection with anything else, which is what keeps `await` inside transactions safe.
 *
 * Writers in this process queue in JavaScript (see withTransaction): a `BEGIN IMMEDIATE` that the
 * driver answers with `SQLITE_BUSY` leaves its statement pending on that pooled connection, and
 * every later COMMIT on it fails with "SQL statements in progress", so contention must never be
 * resolved by letting BEGIN fail and trying again. Another process (the restore command, a script)
 * is waited for by the driver's own busy handler, which blocks the thread; that wait is short
 * because in-process holders never reach it, and a holder that outlasts it is answered with
 * DatabaseBusyError after the poisoned connections are dropped.
 */
export const concurrency = 8;
// The driver's busy handler: how long a BEGIN waits for another process's write lock.
export const busyTimeoutMs = 2_000;
// Per-connection settings. WAL is persistent in the file; the other two are not, so they are
// executed through every pooled connection (see prime).
const pragmas = [
  'pragma journal_mode = wal',
  'pragma synchronous = normal',
  'pragma foreign_keys = on',
].join('; ');

// The pool opens connections lazily and exposes no hook for a new one. Issuing one
// multi-statement call per allowed connection synchronously makes each call borrow a distinct
// connection before any of them runs, so every pooled connection receives the pragmas, and a
// query issued later waits in the pool's FIFO behind them. A connection the pool discards and
// reopens (an unusable one) comes back with libsql's own defaults, which are correct but slower:
// foreign keys on, synchronous full. A reopen of the whole pool primes it again (see reopen).
function prime(client: Client, connections: number) {
  const primed = Promise.all(
    Array.from({ length: connections }, () => client.executeMultiple(pragmas)),
  );
  primed.catch((error: Error) => logger.error({ err: error }, 'Database pragmas failed'));
  return primed.then(() => undefined);
}
export function openClient(url: string, connections = concurrency) {
  mkdirSync(dirname(databasePath(url)), { recursive: true });
  const client = createClient({ url, concurrency: connections, timeout: busyTimeoutMs });
  return Object.assign(client, { primed: prime(client, connections), connections });
}
// Drops every pooled connection and opens the file again with the pragmas in place.
async function reopen(client: DatabaseClient) {
  await client.reconnect();
  client.primed = prime(client, client.connections);
  await client.primed.catch(() => undefined);
}
export type DatabaseClient = ReturnType<typeof openClient>;
// State that must exist once per process. The production bundle carries a copy of this module in
// every server chunk that uses it, so a module-level variable would mean one pool and one write
// queue per chunk; globalThis is shared by all of them.
type Shared = {
  connection: DatabaseClient | undefined;
  // The tail of the write queue: resolves when the transaction queued last has settled.
  writer: Promise<void>;
  // Set while a transaction opened on the pool runs, so a second one in the same async context
  // is refused at once instead of waiting on its own lock.
  holding: AsyncLocalStorage<true>;
};
const sharedKey = Symbol.for('executiveos.db');
function shared(): Shared {
  const host = globalThis as { [sharedKey]?: Shared }; // cast: the process-wide slot this module owns
  host[sharedKey] ??= {
    connection: undefined,
    writer: Promise.resolve(),
    holding: new AsyncLocalStorage<true>(),
  };
  return host[sharedKey];
}
export function pool() {
  const state = shared();
  state.connection ??= openClient(env().DATABASE_URL);
  return state.connection;
}
// Closes and forgets the client, so a restore can swap the file and the next call reopens it.
export function closeDatabase() {
  const state = shared();
  const current = state.connection;
  state.connection = undefined;
  current?.close();
}
// A separate client for audits that rebuild the disposable *_test.db file from migrations.
export function testPool() {
  const url = env().DATABASE_URL_TEST;
  if (!url || !isTestDatabaseUrl(url))
    throw new Error('DATABASE_URL_TEST must name a file whose basename ends in _test.db');
  return openClient(url, 4);
}
export function databaseFor(source: Client): LibSQLDatabase {
  return drizzle(source, { logger: queryLogger });
}
export function db() {
  return databaseFor(pool());
}
export type Database = Pick<
  LibSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'run' | 'all' | 'get' | 'values' | 'transaction'
>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const busyRetryWindowMs = 10_000;
// Drizzle wraps a driver failure in DrizzleQueryError with the libsql error as `cause`; a failed
// BEGIN comes raw. Either way the code is read where the driver put it.
const Coded = z.object({ code: z.string() });
function isBusy(error: Error): boolean {
  const coded = Coded.safeParse(error);
  if (coded.success) return coded.data.code.startsWith('SQLITE_BUSY');
  return error.cause instanceof Error && isBusy(error.cause);
}
export class DatabaseBusyError extends Error {
  constructor(windowMs: number, cause?: Error) {
    super(`The database stayed locked for ${windowMs} ms; the transaction did not start`, {
      cause,
    });
    this.name = 'DatabaseBusyError';
  }
}
// Takes the next place in the write queue and waits for the previous holder, at most `windowMs`.
// The returned release settles this place whether or not the wait succeeded, so the queue never
// stalls behind a caller that gave up.
async function enqueueWriter(windowMs: number) {
  const state = shared();
  let release: () => void = () => undefined;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = state.writer;
  state.writer = previous.then(() => mine);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DatabaseBusyError(windowMs)), windowMs);
  });
  try {
    await Promise.race([previous, expired]);
  } catch (error) {
    release();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return release;
}
/**
 * The one way to open a transaction. On a transaction handle the call is a savepoint. On the pool
 * it is `BEGIN IMMEDIATE` behind the process-wide write queue, so writers of this process never
 * contend at BEGIN: the lock is handed from one transaction to the next in order, and a caller that
 * waits longer than `windowMs` gets DatabaseBusyError. A pool transaction requested inside a running
 * one is a programming error (it would wait on its own lock) and is refused immediately. Only
 * another process can still make BEGIN wait; the driver's busy handler covers busyTimeoutMs of
 * that, after which the client is reopened (a refused BEGIN poisons its connection) and the caller
 * gets DatabaseBusyError.
 */
export async function withTransaction<T>(
  database: Database,
  work: (tx: Transaction) => Promise<T>,
  options: { windowMs?: number } = {},
): Promise<T> {
  if (is(database, SQLiteTransaction)) return database.transaction(work);
  const state = shared();
  if (state.holding.getStore())
    throw new Error(
      'withTransaction on the pool inside an open transaction: use the transaction handle, which makes it a savepoint',
    );
  const windowMs = options.windowMs ?? busyRetryWindowMs;
  const release = await enqueueWriter(windowMs);
  try {
    return await state.holding.run(true, () => beginImmediate(database, work));
  } finally {
    release();
  }
}
async function beginImmediate<T>(database: Database, work: (tx: Transaction) => Promise<T>) {
  let started = false;
  try {
    return await database.transaction(
      (tx) => {
        started = true;
        return work(tx);
      },
      { behavior: 'immediate' },
    );
  } catch (error) {
    if (started || !(error instanceof Error) || !isBusy(error)) throw error;
    // Another process held the lock past the driver's wait. The pooled connection that failed
    // BEGIN is poisoned (its statement stays pending); reopening the pool drops it with the rest.
    const client = shared().connection;
    if (client) await reopen(client);
    throw new DatabaseBusyError(busyTimeoutMs, error);
  }
}
// Serializes other write work (the migrator's own transaction) with the transactions above.
export async function withWriteLock<T>(work: () => Promise<T>, windowMs = busyRetryWindowMs) {
  const release = await enqueueWriter(windowMs);
  try {
    return await shared().holding.run(true, work);
  } finally {
    release();
  }
}
