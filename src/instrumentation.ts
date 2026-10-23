export async function register() {
  const { rawRuntime } = await import('./core/config/env');
  const runtime = rawRuntime();
  if (
    runtime.runtime !== 'nodejs' ||
    runtime.mode === 'test' ||
    runtime.phase === 'phase-production-build'
  )
    return;
  const { migrateDatabase } = await import('./core/db/migrate');
  const { bootstrap } = await import('./core/auth/bootstrap');
  await migrateDatabase();
  await bootstrap();
  const { releaseStaleLock } = await import('./core/backup/maintenance');
  await releaseStaleLock();
  const { removePartialFiles } = await import('./core/files/storage');
  await removePartialFiles();
  const { env } = await import('./core/config/env');
  const { checkConnection } = await import('./core/ai/client');
  await checkConnection();
  let stop = async () => {};
  if (env().JOBS_ENABLED) {
    const { startRunner } = await import('./core/jobs/runner');
    const { watchUpdates } = await import('./modules/users/jobs');
    const stopRunner = startRunner();
    const unwatch = watchUpdates();
    stop = async () => {
      unwatch();
      await stopRunner();
    };
  }
  const { installShutdown } = await import('./core/jobs/shutdown');
  installShutdown(stop, env().NEXT_MANUAL_SIG_HANDLE === 'true');
}
