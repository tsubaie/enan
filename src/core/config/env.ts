import 'server-only';
import { resolve } from 'node:path';
import { z } from 'zod';
import { defaults } from './defaults';
import { validProxyCidrs } from './cidr';

const optionalText = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
// ADR 0029: the database is a SQLite file named by a `file:` URL (`file:./tmp/dev.db`,
// `file:/var/lib/executiveos/data/executiveos.db`). The scheme is checked here so a stale
// PostgreSQL URL fails at startup with one clear message instead of inside the driver.
// A relative path is taken from the directory pnpm was started in (INIT_CWD), so every process
// of one checkout names the same file: the dev server, the scripts, and the standalone server the
// browser suite starts, which changes into its own build directory first.
const absoluteFileUrl = (value: string) => {
  const path = value.slice('file:'.length);
  if (path.startsWith('/')) return value;
  return `file:${resolve(process.env.INIT_CWD ?? process.cwd(), path)}`;
};
const databaseUrl = z
  .string()
  .refine((value) => value.startsWith('file:'), {
    message:
      'DATABASE_URL must be a file: URL naming the SQLite database, for example file:/var/lib/executiveos/data/executiveos.db',
  })
  .transform(absoluteFileUrl);
const Environment = z.object({
  DATABASE_URL: databaseUrl,
  DATABASE_URL_TEST: z.preprocess((v) => (v === '' ? undefined : v), databaseUrl.optional()),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.string().url().default(defaults.appUrl),
  TRUSTED_PROXY_CIDRS: z.string().default('').refine(validProxyCidrs, {
    message:
      'TRUSTED_PROXY_CIDRS must be a comma-separated list of IP addresses or CIDR blocks, for example "10.0.0.0/8, fd00::/8"',
  }),
  OPENROUTER_API_KEY: optionalText,
  AI_RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  FILES_DIR: z.string().default(defaults.filesDir),
  BACKUP_DIR: z.string().default(defaults.backupDir),
  FILES_QUOTA_GB: z.coerce.number().positive().default(20),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(20).default(20),
  // ADMIN-B47: the largest wallpaper image an administrator may upload. The request passes through
  // the proxy (src/proxy.ts), which buffers at most 10 MB of a body (Next's proxyClientMaxBodySize),
  // so the cap cannot exceed that without raising the buffer in next.config.ts too.
  WALLPAPER_MAX_MB: z.coerce.number().positive().max(10).default(10),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  JOBS_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  JOBS_DRAIN_SECONDS: z.coerce.number().int().min(1).max(120).default(25),
  RECOVERY_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .min(
        32,
        'RECOVERY_TOKEN replaces an administrator password and must be at least 32 random characters; generate one with: openssl rand -hex 32',
      )
      .optional(),
  ),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_RUNTIME: optionalText,
  NEXT_PHASE: optionalText,
  // Set in the production image so the job drain, not Next, decides when the process exits.
  NEXT_MANUAL_SIG_HANDLE: optionalText,
});

// ADMIN-B17: a deployment typo must not silently downgrade the session cookie. Loopback is the one
// opt-out, so a production image can still be smoke-tested on a developer machine without TLS.
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function loopback(url: string) {
  return loopbackHosts.has(new URL(url).hostname);
}
const Configuration = Environment.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;
  if (value.APP_URL.startsWith('https:') || loopback(value.APP_URL)) return;
  ctx.addIssue({
    code: 'custom',
    path: ['APP_URL'],
    message: 'APP_URL must use https in production unless it points at a loopback address',
  });
});

export type Environment = z.infer<typeof Environment>;
export function parseEnvironment(source: Record<string, string | undefined>) {
  return Configuration.parse(source);
}
// The Secure flag follows the validated deployment mode: production is HTTPS unless it is the
// loopback opt-out, and a development server marks the cookie only when it actually serves TLS.
export function secureCookies(config: Environment = env()) {
  return config.NODE_ENV === 'production'
    ? !loopback(config.APP_URL)
    : config.APP_URL.startsWith('https:');
}
let cached: Environment | undefined;
function load(): Environment {
  const parsed = parseEnvironment(process.env);
  if (parsed.NODE_ENV === 'test')
    return { ...parsed, DATABASE_URL: databaseUrl.parse(parsed.DATABASE_URL_TEST) };
  return parsed;
}
// Parsed once per process; every request path reads it.
export function env() {
  cached ??= load();
  return cached;
}

export function rawRuntime() {
  return {
    mode: process.env.NODE_ENV,
    runtime: process.env.NEXT_RUNTIME,
    phase: process.env.NEXT_PHASE,
  };
}
