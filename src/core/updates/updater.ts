import 'server-only';
import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { access, readFile, rename, writeFile, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { env } from '@/core/config/env';

// ADMIN-B57, ADR 0051: what the updater service writes on its status volume, read as it is. The
// app never talks to Docker; it reads these files and leaves commands in the other volume.
const Image = z.object({
  digest: z.string().optional(),
  version: z.string().optional(),
  revision: z.string().optional(),
  schema: z.number().optional(),
  contract: z.number().optional(),
});
export const UpdaterStatus = z.object({
  channel: z.string().default(''),
  running: Image.optional(),
  candidate: Image.optional(),
  state: z.string(),
  step: z.string().optional(),
  error: z.string().optional(),
  backup: z.string().optional(),
  restoreCommand: z.string().optional(),
  log: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  lastCheckAt: z.string().optional(),
  paused: z.boolean().default(false),
  // ADMIN-B68: installing without Install now, and the daily window it waits for.
  automatic: z.boolean().default(false),
  window: z.string().optional(),
  timeZone: z.string().optional(),
  // ADMIN-B67: the candidate has a migration the running release cannot read.
  confirm: z.boolean().default(false),
  updaterUpdate: z.string().optional(),
  intervalSeconds: z.number().int().positive().default(900),
});
export type UpdaterStatus = z.infer<typeof UpdaterStatus>;

// The updater's health as the page reports it: `running` means it checked recently enough.
export const UpdaterHealth = z.enum(['running', 'stalled', 'not_running', 'unreadable']);
export type UpdaterHealth = z.infer<typeof UpdaterHealth>;

// Three intervals and five minutes without a check, the same limit as the updater's HEALTHCHECK.
export function stalledAfter(status: UpdaterStatus) {
  return (3 * status.intervalSeconds + 5 * 60) * 1000;
}

export function healthOf(status: UpdaterStatus | null, now: Date): UpdaterHealth {
  if (!status) return 'not_running';
  const last = status.lastCheckAt ? Date.parse(status.lastCheckAt) : NaN;
  if (Number.isNaN(last) || now.getTime() - last > stalledAfter(status)) return 'stalled';
  return 'running';
}

async function readText(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export function parseHistory(text: string | null): UpdaterStatus[] {
  if (!text) return [];
  const entries: UpdaterStatus[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = UpdaterStatus.safeParse(JSON.parse(line));
      if (entry.success) entries.push(entry.data);
    } catch {
      // A line cut short by a crash is skipped; the rest of the history still reads.
    }
  }
  return entries.reverse();
}

async function writable(dir: string) {
  try {
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// ADR 0059: calls changed shortly after the updater replaces status.json (it renames a new file
// over it), so its outcomes are read as they happen. A folder that cannot be watched (no updater
// volume) leaves the daily schedule. Returns the function that stops watching.
export function watchStatus(changed: () => void) {
  let timer: NodeJS.Timeout | undefined;
  try {
    const watcher = watch(env().UPDATER_STATUS_DIR, (_event, name) => {
      if (name !== 'status.json') return;
      // One call for the burst of writes a check or an install step makes.
      clearTimeout(timer);
      timer = setTimeout(changed, 2000);
    });
    watcher.on('error', () => watcher.close());
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch {
    return () => {};
  }
}

export async function readUpdates(now = new Date()) {
  const dir = env().UPDATER_STATUS_DIR;
  const [text, history, commands] = await Promise.all([
    readText(join(dir, 'status.json')),
    readText(join(dir, 'history.jsonl')),
    writable(env().UPDATER_COMMANDS_DIR),
  ]);
  let status: UpdaterStatus | null = null;
  let health: UpdaterHealth = 'not_running';
  if (text !== null) {
    try {
      const parsed = UpdaterStatus.safeParse(JSON.parse(text));
      status = parsed.success ? parsed.data : null;
    } catch {
      status = null;
    }
    health = status ? healthOf(status, now) : 'unreadable';
  }
  return { health, status, history: parseHistory(history), commands };
}

// ADMIN-B58, ADMIN-B67, ADMIN-B68: what Enan may ask of the updater (updater.Command in Go).
export const UpdaterCommand = z.discriminatedUnion('command', [
  z.strictObject({ command: z.enum(['check', 'pause', 'resume', 'retry']) }),
  // Exactly the release the page showed; a contract migration only once confirmed.
  z.strictObject({
    command: z.literal('install'),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    confirm: z.boolean().default(false),
  }),
  // A window is a daily span such as 02:00-05:00, in the updater's time zone; '' is any time.
  z.strictObject({
    command: z.literal('settings'),
    automatic: z.boolean(),
    window: z
      .string()
      .regex(/^$|^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/u)
      .refine((window) => !window || window.slice(0, 5) !== window.slice(6), 'empty window'),
  }),
]);
export type UpdaterCommand = z.infer<typeof UpdaterCommand>;

// ADMIN-B58: a command is a file the updater acts on as it arrives and then deletes. Written
// under a temporary name and renamed, so the updater never reads half of one.
export async function queueCommand(command: UpdaterCommand) {
  const dir = env().UPDATER_COMMANDS_DIR;
  const name = `${Date.now()}-${randomUUID()}.json`;
  await writeFile(join(dir, `.${name}.tmp`), JSON.stringify(command));
  await rename(join(dir, `.${name}.tmp`), join(dir, name));
}
