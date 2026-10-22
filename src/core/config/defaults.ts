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
  cookieName: 'eos_session',
  migrationLock: 7231,
};
