import { env } from '@/core/config/env';
import { ensureTestDatabase } from '@/core/db/test-database';
// Vitest runs this once before any suite. Each worker derives its own *_test.db file beside the
// configured one (tests/setup/worker-database.ts); this creates their shared directory.
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
