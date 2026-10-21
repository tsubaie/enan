import 'server-only';
/**
 * In-process locks keyed by number (ADR 0029). The application is one process (ADR 0003) and
 * SQLite serializes writers itself, so the PostgreSQL advisory locks reduce to a map of promises:
 * `serialized` waits its turn (the migration lock) and releases in `finally`, so a throwing worker
 * frees the key. The restore lock is a file (`withBackupLock`), because restore is its own process.
 */
const held = new Map<number, Promise<undefined>>();
// Marks the key held before the work starts, so work that re-enters sees the lock, and returns
// the release that wakes the waiters once the key is deleted.
function hold(key: number) {
  let release: () => void = () => undefined;
  held.set(
    key,
    new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    }),
  );
  return () => {
    held.delete(key);
    release();
  };
}
export async function serialized<T>(key: number, work: () => Promise<T>): Promise<T> {
  while (held.has(key)) await held.get(key);
  const release = hold(key);
  try {
    return await work();
  } finally {
    release();
  }
}
