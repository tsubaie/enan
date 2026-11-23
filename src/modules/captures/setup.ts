import 'server-only';
import { cache } from 'react';
import { readOnlyDb, type Database } from '@/core/db/client';
import { getSetting } from '@/core/db/settings-repo';
import { settingsRegistry } from '@/core/config/settings';
import { AppError } from '@/core/http/errors';
import type { User } from '@/core/auth/validation';
import type { CaptureSetup } from './schema/validation';
// CAPTURES-B14 CAPTURES-B15: the workspace switch first; with it off the reader's rows are not
// read, because nothing they say can turn recording back on.
export async function captureSetup(database: Database, userId: string): Promise<CaptureSetup> {
  if (!(await getSetting(database, 'captures.enabled')))
    return { allowed: false, enabled: false, shortcut: false };
  const [enabled, shortcut] = await Promise.all([
    getSetting(database, 'user.captures.enabled', userId),
    getSetting(database, 'user.captures.shortcut', userId),
  ]);
  return { allowed: true, enabled, shortcut: enabled && shortcut };
}
// What the shell draws, read once per request (the layout and the inbox page share it). A database
// that cannot be read yet (first start, before migration) draws the built-in defaults; this is for
// rendering only, and `requireRecording` is what refuses audio.
export const readerCapture = cache(async (userId: string): Promise<CaptureSetup> => {
  try {
    return await captureSetup(readOnlyDb(), userId);
  } catch {
    const enabled = settingsRegistry['captures.enabled'].default;
    const own = settingsRegistry['user.captures.enabled'].default;
    const shortcut = settingsRegistry['user.captures.shortcut'].default;
    return { allowed: enabled, enabled: enabled && own, shortcut: enabled && own && shortcut };
  }
});
// CAPTURES-B14: new audio is refused while recording is off, before the body is read. A failed
// read fails the request (nothing is stored), never open.
export async function requireRecording(ctx: { user: User | null; db: Database }) {
  if (!ctx.user) throw new AppError('unauthenticated');
  const setup = await captureSetup(ctx.db, ctx.user.id);
  if (!setup.enabled)
    throw new AppError('forbidden', {
      reason: 'recording_off',
      scope: setup.allowed ? 'account' : 'workspace',
    });
}
