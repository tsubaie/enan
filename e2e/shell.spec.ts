import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };

// ADMIN-B19: the phone bar carries four destinations and a door to the rest. It used to draw
// every entry — seven 44 px slots at zero gap with labels running to 84 px — so the names
// overlapped their neighbours at every width a phone offers and the last one left the screen.
// The measurement is of the labels, not of the markup: the old bar rendered seven perfectly valid
// links and was still unusable.
for (const locale of ['en', 'ar'] as const) {
  for (const width of [320, 390]) {
    test(`ADMIN-B19 the bottom bar's labels fit their slots at ${width} px (${locale})`, async ({
      page,
    }) => {
      const m = locale === 'ar' ? ar : en;
      await loginAs(page, locale);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/home');
      const bar = page.locator('.mobile-navigation');
      await expect(bar).toBeVisible();

      const slots = await bar.evaluate((nav) =>
        [...nav.children].map((slot) => {
          const label = slot.querySelector('span');
          const box = slot.getBoundingClientRect();
          return {
            text: label?.textContent?.trim() ?? '',
            left: box.left,
            right: box.right,
            // A label wider than the slot draws over whatever is beside it.
            overflows: label
              ? label.scrollWidth > Math.ceil(label.getBoundingClientRect().width) + 1
              : false,
          };
        }),
      );

      expect(slots.length).toBe(5);
      expect(slots.filter((slot) => slot.overflows).map((slot) => slot.text)).toEqual([]);
      // No slot may start before its predecessor ends.
      const ordered = [...slots].sort((a, b) => a.left - b.left);
      for (let i = 1; i < ordered.length; i++)
        expect(ordered[i]!.left).toBeGreaterThanOrEqual(ordered[i - 1]!.right - 1);
      // And the whole bar stays on screen, in either direction.
      for (const slot of slots) {
        expect(slot.right).toBeLessThanOrEqual(width + 1);
        expect(slot.left).toBeGreaterThanOrEqual(-1);
      }

      // Nothing is lost: what the bar no longer names is behind the door, administration included.
      await page.getByRole('button', { name: m.common.navMore, exact: true }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('link', { name: m.common.admin, exact: true })).toBeVisible();
      await sheet.getByRole('link', { name: m.common.admin, exact: true }).click();
      await expect(page).toHaveURL(/admin/);
    });
  }
}

// ACCT-B04: the header's language toggle is a radio group of two flags. Choosing the other one
// saves it and reloads the whole page in that language and direction; choosing the current one
// does nothing. The reader's own locale row is removed afterwards, so the account is back on the
// workspace default the other scenarios expect.
test('ACCT-B04 the header language toggle reloads the page in the other language and direction', async ({
  page,
}) => {
  // Below 1024 px the toggle is the last row of the bar's More sheet rather than in the header.
  const reveal = async (m: typeof en) => {
    if ((page.viewportSize()?.width ?? 0) < 1024)
      await page.getByRole('button', { name: m.common.navMore, exact: true }).click();
  };
  await loginAs(page, 'en');
  try {
    await page.goto('/home');
    await reveal(en);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const group = page.getByRole('radiogroup', { name: en.common.language, exact: true });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await expect(group.getByRole('radio', { name: en.common.english })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The current language is not a change: nothing is sent and the page stays.
    let posted = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/v1/preferences') && request.method() === 'POST') posted++;
    });
    await group.getByRole('radio', { name: en.common.english }).click();
    await group.getByRole('radio', { name: ar.common.arabic }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    expect(posted).toBe(1);
    await reveal(ar);
    const arabicGroup = page.getByRole('radiogroup', { name: ar.common.language, exact: true });
    await expect(arabicGroup.getByRole('radio', { name: ar.common.arabic })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await arabicGroup.getByRole('radio', { name: en.common.english }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await reveal(en);
    await expect(
      page
        .getByRole('radiogroup', { name: en.common.language, exact: true })
        .getByRole('radio', { name: en.common.english }),
    ).toHaveAttribute('aria-checked', 'true');
  } finally {
    await page.evaluate(async () => {
      const headers = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'Enan',
      };
      const account = await (await fetch('/api/v1/account', { headers })).json();
      await fetch('/api/v1/account', {
        method: 'PATCH',
        headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ revision: account.data.user.revision, locale: '' }),
      });
    });
  }
});

// ADMIN-B19, 05 § Layout shell: the phone bar floats over the page, so the page leaves room under
// its last line for it. Scrolled to the very end, the last entry of a list sits wholly above the
// bar and a tap on it reaches it rather than the bar.
test('ADMIN-B19 the floating bottom bar never covers the last item of a list @mobile', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin');
  const last = page.locator('section[aria-labelledby^="admin-index-"] a').last();
  await expect(last).toHaveAttribute('href', '/admin/audit');
  // Scroll every scrolling ancestor, and the window, to its end, and measure. The page can still
  // be growing when the first scroll lands (late sections, fonts), which leaves the end further
  // down; scrolling again until the measure holds reads the settled page.
  await expect(async () => {
    await last.evaluate((element) => {
      for (let node = element.parentElement; node; node = node.parentElement)
        if (node.scrollHeight > node.clientHeight) node.scrollTop = node.scrollHeight;
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const bar = await page.locator('.mobile-navigation').boundingBox();
    const item = await last.boundingBox();
    expect(bar && item).toBeTruthy();
    expect(item!.y + item!.height).toBeLessThanOrEqual(bar!.y + 1);
  }).toPass();
  // Playwright refuses a click whose point lands on another element, such as the bar.
  await last.click({ trial: true });
  await last.click();
  await expect(page).toHaveURL(/\/admin\/audit$/u);
});
