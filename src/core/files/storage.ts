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
// half a file. A failed write removes its temporary file; one a crash left is removed at the next
// start (removePartialFiles), since keys are random and no later write would replace it.
export async function writeStoredFile(key: string, bytes: Uint8Array) {
  const root = env().FILES_DIR;
  await mkdir(root, { recursive: true });
  const path = resolveInside(root, key);
  const partial = resolveInside(root, `.${key}.partial`);
  try {
    await writeFile(partial, bytes);
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
// Called once at server start, before anything writes a stored file.
export async function removePartialFiles() {
  const root = env().FILES_DIR;
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isFile() && entry.name.startsWith('.') && entry.name.endsWith('.partial'))
      await rm(join(root, entry.name), { force: true });
}
export async function readStoredFile(key: string) {
  return readFile(resolveInside(env().FILES_DIR, key));
}
export async function removeStoredFile(key: string) {
  await rm(resolveInside(env().FILES_DIR, key), { force: true });
}
