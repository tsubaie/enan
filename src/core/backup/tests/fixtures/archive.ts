// Filesystem helpers for the backup suites. Tests may not import node:fs themselves (audit:tests),
// so every temp-directory and archive operation they need lives here.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { list, Parser } from 'tar';
import { migrateDatabase } from '@/core/db/migrate';
import { openSnapshot } from '../../database';
export type RawEntry = {
  name: string;
  body?: string;
  type?: '0' | '1' | '2' | '5';
  linkname?: string;
  declaredSize?: number;
};
function header(entry: RawEntry, size: number) {
  const block = Buffer.alloc(512);
  block.write(entry.name, 0, 100, 'utf8');
  block.write(entry.type === '5' ? '0000755\0' : '0000644\0', 100);
  block.write('0000000\0', 108);
  block.write('0000000\0', 116);
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  block.write('00000000000\0', 136);
  block.write('        ', 148);
  block.write(entry.type ?? '0', 156);
  if (entry.linkname) block.write(entry.linkname, 157, 100, 'utf8');
  block.write('ustar\0', 257);
  block.write('00', 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}
// A hand-built ustar archive, so adversarial entries need no tool that would refuse to write them.
export function rawTar(entries: RawEntry[]) {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    parts.push(header(entry, entry.declaredSize ?? body.length), body);
    parts.push(Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
export async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'eos-backup-'));
  return {
    root,
    files: join(root, 'files'),
    backups: join(root, 'backups'),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
export async function writeTree(root: string, tree: Record<string, string>) {
  for (const [path, body] of Object.entries(tree)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
}
// Every file under root as path → content, directories included as names only.
export async function readTree(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true }))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      tree[path.slice(root.length + 1)] = await readFile(path, 'utf8');
    }
  return tree;
}
export const names = (root: string) => readdir(root);
export async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
let template: Promise<Buffer> | undefined;
// An empty database at the current schema, built once per process from the migrations in
// rollback-journal mode (so the bytes are complete in the one file), as VACUUM INTO writes it.
export function databaseTemplate() {
  template ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eos-template-'));
    const path = join(dir, 'template.db');
    const client = openSnapshot(path);
    try {
      await migrateDatabase(client);
    } finally {
      client.close();
    }
    const bytes = await readFile(path);
    await rm(dir, { recursive: true, force: true });
    return bytes;
  })();
  return template;
}
// A SQLite file whose migrations ledger says it came from a later release than this code knows.
export async function newerDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'eos-newer-'));
  const path = join(dir, 'newer.db');
  await writeFile(path, await databaseTemplate());
  const client = openSnapshot(path);
  try {
    await client.execute(
      "insert into __drizzle_migrations (hash, created_at) values ('future', 4102444800000)",
    );
  } finally {
    client.close();
  }
  const bytes = await readFile(path);
  await rm(dir, { recursive: true, force: true });
  return bytes;
}
// A valid SQLite file that is not an ExecutiveOS database.
export async function plainDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'eos-plain-'));
  const path = join(dir, 'plain.db');
  const client = openSnapshot(path);
  try {
    await client.execute('create table plain (id integer primary key)');
  } finally {
    client.close();
  }
  const bytes = await readFile(path);
  await rm(dir, { recursive: true, force: true });
  return bytes;
}
// What the restore command does to the live file, done by hand from another "process": a stamped
// copy of a backup's database renamed over the live path, with the old WAL siblings removed.
export async function swapByHand(snapshot: string, live: string, generation: number) {
  const incoming = `${live}.incoming`;
  await writeFile(incoming, await readFile(snapshot));
  const client = openSnapshot(incoming);
  try {
    await client.execute(`pragma user_version = ${generation}`);
  } finally {
    client.close();
  }
  await rm(`${live}-wal`, { force: true });
  await rm(`${live}-shm`, { force: true });
  await rename(incoming, live);
}
// A backup directory as dump.ts writes it, around the given archive bytes and database file.
export async function makeBackup(directory: string, archive: Buffer, database?: Buffer) {
  await mkdir(directory, { recursive: true });
  const db = database ?? (await databaseTemplate());
  await writeFile(join(directory, 'files.tar'), archive);
  await writeFile(join(directory, 'db.sqlite'), db);
  const manifest = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
    appVersion: 'test',
    files: {
      'db.sqlite': { sha256: sha(db), bytes: db.length },
      'files.tar': { sha256: sha(archive), bytes: archive.length },
    },
  };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
// A manifest from before ADR 0029, naming a PostgreSQL dump.
export async function makeLegacyBackup(directory: string) {
  await mkdir(directory, { recursive: true });
  const dump = Buffer.from('PGDMP');
  await writeFile(join(directory, 'db.dump'), dump);
  await writeFile(join(directory, 'files.tar'), rawTar([]));
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
      appVersion: 'test',
      files: {
        'db.dump': { sha256: sha(dump), bytes: dump.length },
        'files.tar': { sha256: sha(rawTar([])), bytes: rawTar([]).length },
      },
    }),
  );
}
export async function rewriteManifest(
  directory: string,
  edit: (value: { files: Record<string, { bytes: number; sha256: string }> }) => void,
) {
  const path = join(directory, 'manifest.json');
  const value = JSON.parse(await readFile(path, 'utf8'));
  edit(value);
  await writeFile(path, JSON.stringify(value));
}
export async function appendTo(path: string, data: string) {
  await writeFile(path, data, { flag: 'a' });
}
export async function archiveNames(file: string) {
  const found: string[] = [];
  await list({ file, onReadEntry: (entry) => found.push(entry.path) });
  return found;
}
// The entry names of a tar archive held in memory, such as a downloaded response body.
export async function bufferNames(data: Buffer) {
  const found: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const parser = new Parser({ onReadEntry: (entry) => (found.push(entry.path), entry.resume()) });
    parser.on('end', resolve);
    parser.on('error', reject);
    parser.end(data);
  });
  return found;
}
