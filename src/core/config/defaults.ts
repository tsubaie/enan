import { z } from 'zod';

export const Locale = z.enum(['en', 'ar']);
export const defaults = {
  locale: Locale.enum.en,
  timezone: 'UTC',
  workspaceName: 'Enan',
  models: { default: 'anthropic/claude-opus-5', fast: 'anthropic/claude-sonnet-5' },
  appUrl: 'http://localhost:3000',
  filesDir: '/var/lib/enan/files',
  backupDir: '/var/lib/enan/backups',
  fontsDir: '/var/lib/enan/fonts',
  // ADMIN-B57, ADR 0051: the updater's volumes, mounted into the app read-only and for commands.
  updaterStatusDir: '/var/lib/enan-updater/status',
  updaterCommandsDir: '/var/lib/enan-updater/commands',
  // ADMIN-B57: a version's release notes are this address followed by the version.
  releaseNotes: 'https://github.com/tsubaie/enan/releases/tag/v',
  cookieName: 'eos_session',
  migrationLock: 7231,
};
