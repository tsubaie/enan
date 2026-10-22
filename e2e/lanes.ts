import { availableParallelism } from 'node:os';

// Lanes: the browser suite runs on several Playwright workers at once, and its tests change state
// (tasks, notes, settings, the workspace itself), so every worker owns a lane — its own SQLite
// file, its own standalone server on its own port, its own files and backups directories and its
// own administrator — and only ever talks to that lane. One production build serves every lane.
// E2E_WORKERS sets how many. The default is 2 on CI (CI is set): measured on its 4-core runners,
// two lanes halve the suite's wall clock while more mostly starve each other. A workstation gets
// about one lane per 3 cores, from 2 to 6 (22 cores: 6 lanes, 5.3 → 2.9 min). Inside a worker,
// E2E_LANE (set by e2e/fixtures/test.ts) picks the lane every helper below defaults to; the audits
// that run after the suite (a11y, perf) keep using lane 0, whose addresses are the historical ones.
const DEFAULT_DATABASE = 'file:./tmp/enan_test.db';
// E2E_FIRST_PORT moves every lane's port (default 3000), so a second checkout or agent can run the
// suite beside one already serving on the historical ports; it also names the credentials files
// apart. Point DATABASE_URL_TEST, FILES_DIR and BACKUP_DIR elsewhere too when doing so.
const FIRST_PORT = (() => {
  const value = Number(process.env.E2E_FIRST_PORT ?? 3000);
  if (!Number.isInteger(value) || value < 1024 || value > 65000)
    throw new Error(`E2E_FIRST_PORT must be a port number, got ${process.env.E2E_FIRST_PORT}`);
  return value;
})();

const DEFAULT_LANES = process.env.CI
  ? 2
  : Math.min(6, Math.max(2, Math.floor(availableParallelism() / 3)));

export const lanes = (() => {
  const value = Number(process.env.E2E_WORKERS ?? DEFAULT_LANES);
  if (!Number.isInteger(value) || value < 1 || value > 8)
    throw new Error(
      `E2E_WORKERS must be a whole number from 1 to 8, got ${process.env.E2E_WORKERS}`,
    );
  return value;
})();

export const laneList = Array.from({ length: lanes }, (_, lane) => lane);

export function currentLane() {
  const value = Number(process.env.E2E_LANE ?? 0);
  if (!laneList.includes(value))
    throw new Error(`E2E_LANE must be 0–${lanes - 1}, got ${process.env.E2E_LANE}`);
  return value;
}

export function laneBaseURL(lane = currentLane()) {
  return `http://localhost:${FIRST_PORT + lane}`;
}

/** Lane 0 keeps the historical file; the other lanes get their own beside it. */
export function credentialsFile(lane = currentLane()) {
  const port = FIRST_PORT === 3000 ? '' : `-port${FIRST_PORT}`;
  return lane === 0
    ? `e2e/.auth/credentials${port}.json`
    : `e2e/.auth/credentials${port}-lane${lane}.json`;
}

/** The environment a lane's server and database scripts run with. */
export function laneEnv(lane: number): Record<string, string> {
  const database = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || DEFAULT_DATABASE;
  const url = lane === 0 ? database : database.replace(/_test\.db$/u, `-lane${lane}_test.db`);
  if (lane > 0 && url === database)
    throw new Error(
      `The test database must be a file ending in _test.db to run lanes: ${database}`,
    );
  const suffix = lane === 0 ? '' : `-lane${lane}`;
  return {
    DATABASE_URL: url,
    DATABASE_URL_TEST: url,
    APP_URL: laneBaseURL(lane),
    FILES_DIR: (process.env.FILES_DIR || './tmp/files') + suffix,
    BACKUP_DIR: (process.env.BACKUP_DIR || './tmp/backups') + suffix,
    PORT: String(FIRST_PORT + lane),
    HOSTNAME: '127.0.0.1',
  };
}
