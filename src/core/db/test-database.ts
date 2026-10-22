import 'server-only';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
// The local path a `file:` URL names, as libsql resolves it: `file:./tmp/dev.db`,
// `file:/var/lib/enan/data/enan.db` and `file:///var/…` are all accepted, and query
// parameters (`?mode=…`) are not part of the path.
export function databasePath(url: string) {
  const bare = url.replace(/^file:/u, '').replace(/\?.*$/u, '');
  return decodeURIComponent(bare.replace(/^\/\/(?:localhost)?(?=\/)/u, ''));
}
// Disposable *_test.db files used by the unit suites and the database-backed audits: the same
// `_test` rule PostgreSQL databases had, applied to the file's basename (ADR 0029).
export function isTestDatabaseUrl(url: string) {
  return basename(databasePath(url)).endsWith('_test.db');
}
export function assertTestDatabase(url: string) {
  const path = databasePath(url);
  const name = basename(path);
  if (!name.endsWith('_test.db'))
    throw new Error(`Test database file name must end with _test.db, received "${name}"`);
  return { url, path, name };
}
// Creates the parent directory; the file itself appears when the client first opens it.
export async function ensureTestDatabase(url: string) {
  const { path, name } = assertTestDatabase(url);
  await mkdir(dirname(path), { recursive: true });
  return name;
}
// Test support: a database file and its WAL siblings go together, and a read-only file is how
// the suites provoke errors outside a statement (ADMIN-B38).
export async function removeDatabaseFiles(path: string) {
  for (const suffix of ['', '-wal', '-shm']) await rm(`${path}${suffix}`, { force: true });
}
// Test support: a directory a suite made for its own database files.
export function removeDatabaseDirectory(dir: string) {
  return rm(dir, { recursive: true, force: true });
}
export function setDatabaseReadOnly(path: string, readOnly: boolean) {
  return chmod(path, readOnly ? 0o444 : 0o644);
}
