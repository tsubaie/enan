import { defineConfig, devices } from '@playwright/test';
import { laneBaseURL, laneEnv, laneList, lanes } from './e2e/lanes';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Files run whole, one per worker; each worker owns a lane (e2e/lanes.ts, e2e/fixtures/test.ts).
  fullyParallel: false,
  workers: lanes,
  forbidOnly: true,
  retries: 0,
  // Assertions wait up to 10 s (Playwright's default is 5): on the CI host several jobs share the
  // cores, and a server-rendered page can take more than 5 s to appear without anything being wrong.
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Lane 0's address; e2e/fixtures/test.ts moves each worker to its own lane.
    baseURL: laneBaseURL(0),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // One production build, one server per lane (its own port, database, files and backups).
  // Reuses a server already answering on a lane's port; otherwise serves the build for CI.
  webServer: laneList.map((lane) => ({
    command: 'node .next/standalone/server.js',
    url: `${laneBaseURL(lane)}/api/v1/health`,
    reuseExistingServer: true,
    timeout: 120000,
    env: laneEnv(lane),
  })),
  projects: [
    {
      name: 'desktop',
      // Scenarios tagged @mobile exercise the phone layout: the floating bar and the admin index.
      grepInvert: /@mobile/u,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      // Scenarios tagged @desktop exercise controls that only exist beside an open detail panel.
      grepInvert: /@desktop/u,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
