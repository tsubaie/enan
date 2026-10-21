// Every Vitest worker gets its own database file and its own files and backups directories
// (ADR 0029 § Test databases), so test files run in parallel without sharing state. This runs
// before each test file's imports, so env() reads the worker's values. The names derive from the
// configured ones and keep the _test.db ending the database client insists on. A worker runs many
// files in one process, so a value already carrying its suffix is left alone.
const suffix = `-w${process.env.VITEST_POOL_ID ?? '0'}`;
const database = process.env.DATABASE_URL_TEST;
if (database && /_test\.db$/u.test(database) && !database.endsWith(`${suffix}_test.db`)) {
  const url = database.replace(/_test\.db$/u, `${suffix}_test.db`);
  process.env.DATABASE_URL_TEST = url;
  process.env.DATABASE_URL = url;
}
for (const name of ['FILES_DIR', 'BACKUP_DIR'] as const) {
  const value = process.env[name];
  if (value && !value.endsWith(suffix)) process.env[name] = `${value}${suffix}`;
}
