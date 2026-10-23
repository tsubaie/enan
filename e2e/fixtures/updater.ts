import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { updaterDirs } from '../lanes';

// ADMIN-B57: what the updater would have written, for the worker's lane. Specs may not touch the
// filesystem themselves (audit:tests).
export async function updaterWrote(status: object | null, history: object[] = []) {
  const dirs = updaterDirs();
  await rm(dirs.status, { recursive: true, force: true });
  await rm(dirs.commands, { recursive: true, force: true });
  await mkdir(dirs.status, { recursive: true });
  await mkdir(dirs.commands, { recursive: true });
  if (status) await writeFile(join(dirs.status, 'status.json'), JSON.stringify(status));
  await writeFile(
    join(dirs.status, 'history.jsonl'),
    history.map((entry) => JSON.stringify(entry)).join('\n'),
  );
}
export async function commandsLeft() {
  return (await readdir(updaterDirs().commands)).filter((file) => file.endsWith('.json'));
}
// ADMIN-B67, ADMIN-B68: what Enan asked of the updater, oldest first.
export async function commandsSent(): Promise<object[]> {
  const dir = updaterDirs().commands;
  const files = (await commandsLeft()).sort();
  return Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(dir, file), 'utf8')) as object), // cast: the file is JSON Enan wrote
  );
}
