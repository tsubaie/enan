// Filesystem helpers for the updater suites. Tests may not import node:fs themselves (audit:tests),
// so the two folders the updater shares with Enan are made and read here.
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Folders = { root: string; status: string; commands: string };

export async function folders(): Promise<Folders> {
  const root = await mkdtemp(join(tmpdir(), 'enan-updater-'));
  return { root, status: join(root, 'status'), commands: join(root, 'commands') };
}
// Empty status and commands folders; the status file and history are written when given.
export async function reset(dirs: Folders, status?: string | null, history?: string) {
  await rm(dirs.status, { recursive: true, force: true });
  await rm(dirs.commands, { recursive: true, force: true });
  await mkdir(dirs.status, { recursive: true });
  await mkdir(dirs.commands, { recursive: true });
  if (status != null) await writeFile(join(dirs.status, 'status.json'), status);
  if (history !== undefined) await writeFile(join(dirs.status, 'history.jsonl'), history);
}
export async function commandsLeft(dirs: Folders) {
  const files = (await readdir(dirs.commands)).sort();
  const bodies = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(dirs.commands, file), 'utf8'))),
  );
  return { files, commands: bodies.map((body) => String(body.command)) };
}
export const readOnly = (dirs: Folders) => chmod(dirs.commands, 0o500);
export const writable = (dirs: Folders) => chmod(dirs.commands, 0o700);
export const removeCommands = (dirs: Folders) => rm(dirs.commands, { recursive: true });
export const removeAll = (dirs: Folders) => rm(dirs.root, { recursive: true, force: true });
