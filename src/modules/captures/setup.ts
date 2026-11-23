import 'server-only';
import { cache } from 'react';
import { readOnlyDb, type Database } from '@/core/db/client';
import { getSetting } from '@/core/db/settings-repo';
import { settingsRegistry } from '@/core/config/settings';
import { AppError } from '@/core/http/errors';
import type { User } from '@/core/auth/validation';
import type { CaptureSetup } from './schema/validation';
const builtIn = {
  mobile: settingsRegistry['captures.default_mobile_placement'].default,
  desktop: settingsRegistry['captures.default_desktop_placement'].default,
};
// CAPTURES-B14 CAPTURES-B15: the workspace switch first; with it off the reader's rows are not
// read, because nothing they say can turn recording back on (the placement is then unused).
// CAPTURES-B16: a placement is the reader's own concrete row, else the workspace default, else the
// built-in one. `workspace` is never stored, so it reads as the absent row.
export async function captureSetup(database: Database, userId: string): Promise<CaptureSetup> {
  if (!(await getSetting(database, 'captures.enabled')))
    return { allowed: false, enabled: false, shortcut: false, ...builtIn };
  const [enabled, shortcut, mobile, side, desktop, workspaceMobile, workspaceDesktop] =
    await Promise.all([
      getSetting(database, 'user.captures.enabled', userId),
      getSetting(database, 'user.captures.shortcut', userId),
      getSetting(database, 'user.captures.mobile_placement', userId),
      getSetting(database, 'user.captures.floating_side', userId),
      getSetting(database, 'user.captures.desktop_placement', userId),
      getSetting(database, 'captures.default_mobile_placement'),
      getSetting(database, 'captures.default_desktop_placement'),
    ]);
  return {
    allowed: true,
    enabled,
    shortcut: enabled && shortcut,
    mobile:
      mobile === 'workspace' ? workspaceMobile : mobile === 'more' ? 'more' : `floating-${side}`,
    desktop: desktop === 'workspace' ? workspaceDesktop : desktop,
  };
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
    return {
      allowed: enabled,
      enabled: enabled && own,
      shortcut: enabled && own && shortcut,
      ...builtIn,
    };
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
