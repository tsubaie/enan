import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
// Schema version 2 (ADR 0029): the database travels as a SQLite file written by VACUUM INTO.
// Version 1 carried a PostgreSQL `db.dump` and is refused by name, not by a parse error.
export const manifestSchemaVersion = 2;
const FileName = z.enum(['db.sqlite', 'files.tar']);
export const manifestFiles = FileName.options;
export const Manifest = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  schemaVersion: z.number(),
  appVersion: z.string(),
  files: z.record(FileName, z.object({ sha256: z.string(), bytes: z.number().int().nonnegative() })),
});
const LegacyManifest = z.object({ files: z.object({ 'db.dump': z.unknown() }) });
export async function checksum(path: string, signal?: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, signal ? { signal } : {})) hash.update(chunk);
  return hash.digest('hex');
}
// ADMIN-B32: the declared size is checked before the checksum, so a file that grew or shrank is
// refused without hashing it, and restore can trust `bytes` as the ceiling for extraction.
// The cheap half of verifying: the manifest parses and every file has the size it names. Enough
// to list a backup; a download or a restore also reads the checksums (verifyBackup).
export async function readBackup(directory: string) {
  const raw: unknown = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (LegacyManifest.safeParse(raw).success)
    throw new Error(
      'Backup holds a PostgreSQL dump (db.dump) from before ADR 0029; this version restores db.sqlite backups only',
    );
  const manifest = Manifest.parse(raw);
  for (const [name, value] of Object.entries(manifest.files))
    if ((await stat(join(directory, name))).size !== value.bytes)
      throw new Error('Backup size mismatch');
  return manifest;
}
export async function verifyBackup(directory: string, signal?: AbortSignal) {
  const manifest = await readBackup(directory);
  for (const [name, value] of Object.entries(manifest.files))
    if ((await checksum(join(directory, name), signal)) !== value.sha256)
      throw new Error('Backup checksum mismatch');
  return manifest;
}
