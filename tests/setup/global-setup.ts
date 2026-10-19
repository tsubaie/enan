import { env } from '@/core/config/env';
import { ensureTestDatabase } from '@/core/db/test-database';
// Vitest runs this once before any suite. Integration suites share one *_test.db file, run one
// file at a time (vitest.config.ts fileParallelism: false); this creates its directory.
export default async function setup() {
  let url: string;
  try {
    url = env().DATABASE_URL;
  } catch {
    process.stdout.write(
      'DATABASE_URL_TEST is not configured; integration suites will fail. See README § Development.\n',
    );
    return;
  }
  await ensureTestDatabase(url);
}
