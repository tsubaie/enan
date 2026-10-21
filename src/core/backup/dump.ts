import 'server-only';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile, rename, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { create } from 'tar';
import { env } from '@/core/config/env';
import { resolveInside } from '@/core/files/storage';
import {
  checksum,
  Manifest,
  manifestFiles,
  manifestSchemaVersion,
  readBackup,
  verifyBackup,
} from './manifest';
import { snapshotDatabase } from './database';
import { isRestoreWorkspace } from './swap';
import { appVersion } from '@/core/config/version';
// A restore in progress keeps its staging and retired directories inside FILES_DIR; they are
// never part of a backup.
function outsideRestoreWorkspace(path: string) {
  return !isRestoreWorkspace(path.replace(/^\.\//u, '').split('/')[0] ?? '');
}
async function writeBackup(backupId: string, staging: string, signal: AbortSignal) {
  await mkdir(env().FILES_DIR, { recursive: true });
  await snapshotDatabase(join(staging, 'db.sqlite'), signal);
  await pipeline(
    create({ cwd: env().FILES_DIR, portable: true, filter: outsideRestoreWorkspace }, ['.']),
    createWriteStream(join(staging, 'files.tar')),
    { signal },
  );
  const entries = await Promise.all(
    manifestFiles.map(async (name) => [
      name,
      {
        sha256: await checksum(join(staging, name), signal),
        bytes: (await stat(join(staging, name))).size,
      },
    ]),
  );
  const manifest = {
    id: backupId,
    createdAt: new Date().toISOString(),
    schemaVersion: manifestSchemaVersion,
    appVersion,
    files: Object.fromEntries(entries),
  };
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { signal });
  await verifyBackup(staging, signal);
  signal.throwIfAborted();
  return manifest;
}
// ADMIN-B33: every phase observes the signal, and a backup that does not finish leaves no
// staging directory behind.
export async function createBackup(backupId: string, signal = new AbortController().signal) {
  const root = env().BACKUP_DIR;
  const directory = resolveInside(root, backupId);
  await mkdir(root, { recursive: true });
  try {
    const existing = await stat(directory);
    if (existing.isDirectory()) return await verifyBackup(directory);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  const staging = resolveInside(root, `.${backupId}-${crypto.randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    const manifest = await writeBackup(backupId, staging, signal);
    await rename(staging, directory);
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
export async function listBackups() {
  const root = env().BACKUP_DIR;
  await mkdir(root, { recursive: true });
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      try {
        // The page polls this list, so it reads manifests and sizes, never the checksums.
        result.push(await readBackup(resolveInside(root, entry.name)));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
// ADMIN-B12 ADMIN-B48: keeps the `keep` newest backups and deletes the older ones; 0 keeps every
// backup. Only backups that verify are counted or removed, so a folder this code cannot read as a
// backup is never deleted. Returns the ids removed.
export async function pruneBackups(keep: number) {
  if (keep <= 0) return [];
  const root = env().BACKUP_DIR;
  await mkdir(root, { recursive: true });
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const manifest = await verifyBackup(resolveInside(root, entry.name));
      found.push({ name: entry.name, createdAt: manifest.createdAt });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
  found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const removed = found.slice(keep).map((backup) => backup.name);
  for (const name of removed) await rm(resolveInside(root, name), { recursive: true, force: true });
  return removed;
}
// ADMIN-B12: deletes one backup for good. Only a folder whose manifest names it counts as a backup;
// anything else is left alone and answered false. The checksums are not read, so a damaged
// backup can be deleted too.
export async function deleteBackup(backupId: string) {
  const directory = resolveInside(env().BACKUP_DIR, backupId);
  try {
    const raw = await readFile(join(directory, 'manifest.json'), 'utf8');
    if (Manifest.parse(JSON.parse(raw)).id !== backupId) return false;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return false;
  }
  await rm(directory, { recursive: true, force: true });
  return true;
}
// ADMIN-B44: one backup as a single download: its folder (manifest, database and files) packed
// into a tar archive as it is read, after the same checks a restore makes, so a damaged or
// tampered backup is refused rather than handed out. Nothing is written to disk.
export async function backupArchive(backupId: string) {
  const root = env().BACKUP_DIR;
  const manifest = await verifyBackup(resolveInside(root, backupId));
  return { manifest, stream: create({ cwd: root, portable: true }, [backupId]) };
}
