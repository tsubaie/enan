import type { Page } from '@playwright/test';
import { expect } from './test';
// ADR 0072: a streamed page hydrates on its own, after the root, and React drops a click that
// lands on a control that has not hydrated yet. `html[data-hydrated]` is set by the page's own
// boundary and the shell's (src/ui/layout/HydrationMark.tsx), so a scenario's first interaction
// waits for it rather than for a timer. It is a test-only gate: the product's hydration latency is
// tracked on its own.
export async function waitReady(page: Page) {
  await expect(page.locator('html[data-hydrated]')).toHaveCount(1);
}
export async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await waitReady(page);
}
export async function reloadReady(page: Page) {
  await page.reload();
  await waitReady(page);
}
