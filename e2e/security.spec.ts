import { expect, test } from './fixtures/test';
test('ADMIN-B34 pages carry a per-request nonce policy and run without CSP violations', async ({
  page,
  request,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/iu.test(message.text()))
      violations.push(message.text());
  });
  const first = await request.get('/login');
  const second = await request.get('/login');
  const policy = first.headers()['content-security-policy'] ?? '';
  const nonce = policy.match(/'nonce-([^']+)'/u)?.[1];
  expect(nonce).toBeTruthy();
  expect(second.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(first.headers()['x-content-type-options']).toBe('nosniff');
  expect(first.headers()['referrer-policy']).toBe('same-origin');
  expect(await first.text()).toContain(`nonce="${nonce}"`);
  await page.goto('/login');
  await expect(page.getByRole('button').first()).toBeVisible();
  await page.getByLabel(/email/iu).fill('someone@example.test');
  expect(violations).toEqual([]);
});
test('ADMIN-B34 API responses are uncached, nosniff and allow no active content', async ({
  request,
}) => {
  const response = await request.get('/api/v1/health');
  const headers = response.headers();
  expect(headers['cache-control']).toContain('no-store');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['content-security-policy']).toBe(
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
});

// ADMIN-B54: an updater accepts a new container only when health names the version and the commit
// it expects, so an old container that is still answering is never mistaken for the new one.
test('ADMIN-B54 health reports the version and the build revision', async ({ request }) => {
  const health = await (await request.get('/api/v1/health')).json();
  expect(health).toMatchObject({ status: 'ok', db: true, revision: 'e2e-revision' });
  expect(health.version).toMatch(/^\d+\.\d+\.\d+/u);
});
