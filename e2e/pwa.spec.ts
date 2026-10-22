import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };

// ADMIN-B52: an installed web app on iOS keeps a navigation in its own window only when the target
// is inside the manifest's scope; anything else opens an in-app Safari sheet. Playwright cannot run
// a home-screen app, so this checks the inputs iOS decides on: the manifest, and that every tab is
// a same-origin, same-window navigation inside its scope.
test('ADMIN-B52 the manifest scopes the installed app to the whole origin', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const response = await request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });

  // iOS takes its home-screen icon from apple-touch-icon and ignores SVG, so each icon must be a PNG.
  const icons = [
    ...manifest.icons
      .filter((icon: { type: string }) => icon.type === 'image/png')
      .map((icon: { src: string }) => icon.src),
    await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'),
  ];
  expect(icons).toHaveLength(3);
  for (const src of icons) {
    const image = await request.get(src!);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toBe('image/png');
  }
});

test('ADMIN-B52 the phone tabs navigate in the same window on the same origin @mobile', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const opened: string[] = [];
  context.on('page', (other) => opened.push(other.url()));
  await loginAs(page, 'en');
  await page.goto('/home');

  const bar = page.locator('.mobile-navigation');
  const links = bar.getByRole('link');
  const count = await links.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    expect(await link.getAttribute('target')).toBeNull();
    const path = await link.getAttribute('href');
    expect(path).toMatch(/^\/(?!\/)/);
    await link.click();
    // The same origin and page; a list may add its default view to the query as it opens.
    const target = new URL(path!, origin);
    await expect(page).toHaveURL(
      (url) => url.origin === origin && url.pathname === target.pathname,
    );
    // Let the page settle before the next tab, as a person would: a list that records its default
    // view as it opens can otherwise pull a tap made in that instant back to itself (#59). Settled
    // means the network is quiet and the address has not changed for a moment.
    await page.waitForLoadState('networkidle');
    await expect
      .poll(async () => {
        const before = page.url();
        await page.waitForTimeout(400);
        return page.url() === before;
      })
      .toBe(true);
  }

  // The rest of the destinations sit behind More; administration is one of them.
  await page.getByRole('button', { name: en.common.navMore, exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: en.common.admin, exact: true }).click();
  await expect(page).toHaveURL(`${origin}/admin`);
  expect(opened).toEqual([]);
});

test('ADMIN-B52 the start address and a signed-out page redirect inside the scope', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/login`);
  await page.goto('/tasks');
  await expect(page).toHaveURL(`${origin}/login`);
  await loginAs(page, 'en');
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/home`);
});

// ADMIN-B53: iOS reports safe-area insets only to a page that covers the screen, and draws an
// installed app under the status bar only with the translucent style. Playwright has no notch, so
// this checks the declarations iOS reads.
test('ADMIN-B53 pages cover the screen under a translucent status bar', async ({ page }) => {
  for (const path of ['/login', '/home']) {
    if (path === '/home') await loginAs(page, 'en');
    await page.goto(path);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /viewport-fit=cover/,
    );
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute('content', 'black-translucent');
  }
});
