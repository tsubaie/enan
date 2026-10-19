import { execFileSync } from 'node:child_process';
import { request } from '@playwright/test';
import { credentials } from './fixtures/auth';
import { credentialsFile, laneBaseURL, laneEnv, laneList } from './lanes';
// Runs after the web servers are up, once per lane (e2e/lanes.ts): empties the lane's `_test`
// database (scripts/db/e2e-reset.ts), then provisions the lane's browser-test administrator
// through the real first-run setup API when the workspace is empty, otherwise reuses the lane's
// credentials file.
export default async function globalSetup() {
  for (const lane of laneList) {
    const env = { ...process.env, ...laneEnv(lane), E2E_CREDENTIALS_FILE: credentialsFile(lane) };
    execFileSync(
      process.execPath,
      ['--conditions=react-server', '--import', 'tsx', 'scripts/db/e2e-reset.ts'],
      { stdio: ['ignore', 'inherit', 'inherit'], env },
    );
    const state = execFileSync(
      process.execPath,
      ['--conditions=react-server', '--import', 'tsx', 'scripts/db/e2e-account.ts'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env },
    ).trim();
    if (state !== 'provisioned') continue;
    const baseURL = laneBaseURL(lane);
    const account = await credentials(lane);
    const api = await request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL, 'X-Requested-With': 'ExecutiveOS' },
    });
    const response = await api.post('/api/v1/setup', {
      data: {
        email: account.email,
        password: account.password,
        name: account.name,
        workspaceName: 'E2E Office',
        locale: 'en',
        timezone: 'UTC',
        setupToken: account.setupToken,
        principalName: '',
      },
    });
    if (!response.ok())
      throw new Error(
        `First-run setup failed on lane ${lane}: ${response.status()} ${await response.text()}`,
      );
    await api.dispose();
  }
}
