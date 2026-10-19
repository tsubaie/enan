import 'server-only';
import { mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { env } from '@/core/config/env';
export function resolveInside(root: string, key: string) {
  const path = resolve(root, key);
  if (!path.startsWith(resolve(root) + sep)) throw new Error('Path outside storage');
  return path;
}
export async function storageUsage() {
  const root = env().FILES_DIR;
  await mkdir(root, { recursive: true });
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isFile()) total += (await stat(join(root, entry.name))).size;
  return total;
}
// A stored binary is written beside its final name and renamed into place, so a reader never sees
// half a file and a crash leaves only a temporary file the next write replaces.
export async function writeStoredFile(key: string, bytes: Uint8Array) {
  const root = env().FILES_DIR;
  await mkdir(root, { recursive: true });
  const path = resolveInside(root, key);
  const partial = resolveInside(root, `.${key}.partial`);
  await writeFile(partial, bytes);
  await rename(partial, path);
}
export async function readStoredFile(key: string) {
  return readFile(resolveInside(env().FILES_DIR, key));
}
export async function removeStoredFile(key: string) {
  await rm(resolveInside(env().FILES_DIR, key), { force: true });
}
