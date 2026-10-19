import { test as base, expect } from '@playwright/test';
import { laneBaseURL, lanes } from '../lanes';

// Every spec imports `test` from here. Each worker runs in its own lane (e2e/lanes.ts): the
// worker fixture records the lane in E2E_LANE, so the helpers the specs call (credentials,
// loginAs, laneBaseURL) default to it, and `baseURL` sends the browser and request contexts to
// the lane's own server.
export const test = base.extend<Record<never, never>, { lane: number }>({
  lane: [
    // Playwright reads a fixture's dependencies from this destructuring pattern; this one has none.
    async ({}, provide, workerInfo) => {
      const lane = workerInfo.parallelIndex % lanes;
      process.env.E2E_LANE = String(lane);
      await provide(lane);
    },
    { scope: 'worker', auto: true },
  ],
  baseURL: async ({ lane }, provide) => {
    await provide(laneBaseURL(lane));
  },
});

export { expect };
