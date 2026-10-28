import 'server-only';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createClient,
  type Client,
  type InStatement,
  type Transaction as LibsqlTransaction,
  type TransactionMode,
} from '@libsql/client';
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
// ADMIN-B50: a volume from before the rename to Enan still holds executiveos.db. The first open of
// enan.db in that directory takes it over, the -wal and -shm files first and the database last, so
// an interrupted move finishes on the next start.
const formerName = 'executiveos.db';
function adoptFormerDatabase(path: string) {
  if (basename(path) !== 'enan.db' || existsSync(path)) return;
  const former = join(dirname(path), formerName);
  if (!existsSync(former)) return;
  for (const suffix of ['-wal', '-shm', ''])
    if (existsSync(former + suffix)) renameSync(former + suffix, path + suffix);
  logger.info({ from: former, to: path }, 'Database renamed to the Enan file name');
}
export function openClient(url: string, connections = concurrency) {
  mkdirSync(dirname(databasePath(url)), { recursive: true });
  adoptFormerDatabase(databasePath(url));
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
const sharedKey = Symbol.for('enan.db');
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
const writes = /^\s*(?:insert|update|delete|replace)\b/iu;
const writing = (statement: InStatement) =>
  writes.test(typeof statement === 'string' ? statement : statement.sql);
// A method read through the proxy runs on the real object, whose private fields it needs.
const bound = <T>(target: object, value: T) =>
  typeof value === 'function' ? value.bind(target) : value;
// A transaction that holds its turn in the write queue from BEGIN until it commits or rolls back.
function queuedTransaction(client: Client, mode?: TransactionMode) {
  return new Promise<LibsqlTransaction>((resolve, reject) => {
    withWriteLock(async () => {
      const tx = await client.transaction(mode);
      await new Promise<void>((ended) => {
        // A commit that fails leaves the transaction open and the file locked: the turn is kept
        // until the rollback that always follows it (drizzle), never handed to the next writer.
        const end = (name: 'commit' | 'rollback') => async () => {
          if (name === 'commit') {
            await tx.commit();
            ended();
            return;
          }
          try {
            await tx.rollback();
          } finally {
            ended();
          }
        };
        resolve(
          new Proxy(tx, {
            get: (target, key) =>
              key === 'commit' || key === 'rollback'
                ? end(key)
                : bound(target, Reflect.get(target, key)),
          }),
        );
      });
    }).catch(reject);
  });
}
/**
 * ADR 0029 for code that writes through a library's own queries (Better Auth's adapter): the
 * client's writes and transactions take their turn in the write queue, its reads do not. Slow work
 * around them (a password check, a call to Google) never holds the queue, and a write never meets
 * an open transaction in the driver, where it would block the process and then fail busy.
 */
export function queuedWrites(client: Client): Client {
  return new Proxy(client, {
    get(target, key) {
      if (key === 'execute')
        return (statement: InStatement) =>
          writing(statement)
            ? withWriteLock(() => target.execute(statement))
            : target.execute(statement);
      if (key === 'batch')
        return (statements: InStatement[], mode?: Parameters<Client['batch']>[1]) =>
          statements.some(writing)
            ? withWriteLock(() => target.batch(statements, mode))
            : target.batch(statements, mode);
      if (key === 'transaction') return (mode?: TransactionMode) => queuedTransaction(target, mode);
      return bound(target, Reflect.get(target, key));
    },
  });
}
/**
 * ADR 0067: the pool for a request that only reads. Its statements run outside the write queue on
 * whichever connection is free, and a write on it is refused, so a handler that runs without a
 * transaction cannot write on the pool unnoticed. A service's own withTransaction on this handle
 * still works: the transaction is the real client's, taken through the queue (ADR 0054).
 */
export function readOnlyDb(): Database {
  const refuse = (statement: InStatement) => {
    if (writing(statement))
      throw new Error('Write outside a transaction on a read-only request (ADR 0067)');
  };
  return databaseFor(
    new Proxy(pool(), {
      get(target, key) {
        if (key === 'execute')
          return (statement: InStatement) => {
            refuse(statement);
            return target.execute(statement);
          };
        if (key === 'batch')
          return (statements: InStatement[], mode?: Parameters<Client['batch']>[1]) => {
            statements.forEach(refuse);
            return target.batch(statements, mode);
          };
        return bound(target, Reflect.get(target, key));
      },
    }),
  );
}
