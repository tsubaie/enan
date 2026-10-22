import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
const quarterOfMonth = (month: number) => Math.floor(month / 3) + 1;
async function createKpi(page: Page, m: typeof en, name: string) {
  await page.goto(`/kpis?view=all&q=${encodeURIComponent(name)}`);
  await page.getByRole('button', { name: m.common.create, exact: true }).click();
  await page.getByLabel(m.kpis.name, { exact: true }).fill(name);
  // The unit is a closed list, so it is chosen rather than typed (KPIS-B08).
  await page.getByLabel(m.kpis.unit, { exact: true }).click();
  await page.getByRole('option', { name: m.kpis.unitPoints, exact: true }).click();
  await page.getByRole('button', { name: m.common.create, exact: true }).last().click();
  await expect(page).toHaveURL(/id=/);
  return {
    detail: page.locator('aside.entity-detail'),
    id: new URL(page.url()).searchParams.get('id') ?? '',
  };
}
// Writes that a unit scenario already covers go through the API here, so a browser scenario spends
// its time on what it is about: whether the page recomputes what it shows.
const send = (page: Page, path: string, method: string, body: object) =>
  page.evaluate(
    async (call: { url: string; verb: string; payload: string }) => {
      await fetch(`/api/v1${call.url}`, {
        method: call.verb,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Enan',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: call.payload,
      });
    },
    { url: path, verb: method, payload: JSON.stringify(body) },
  );
const addReading = (page: Page, id: string, day: string, value: number) =>
  send(page, `/kpis/${id}/readings`, 'POST', { readingDate: day, value, note: '' });
function setTarget(page: Page, id: string, targetValue: number) {
  const now = new Date();
  return send(page, `/kpis/${id}/targets`, 'PUT', {
    items: [
      {
        year: now.getUTCFullYear(),
        period: quarterOfMonth(now.getUTCMonth()),
        targetValue,
      },
    ],
  });
}
const today = () => new Date().toISOString().slice(0, 10);
for (const locale of ['en', 'ar']) {
  const m = locale === 'ar' ? ar : en;
  test(`KPIS-A01 KPIS-A05 a reading and a target move a KPI from no data to a scored status ${locale}`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const name = `KPI ${crypto.randomUUID()}`;
    const { detail, id } = await createKpi(page, m, name);
    // A measure with nothing recorded against it says so rather than scoring zero.
    await expect(detail.getByText(m.kpis.no_data, { exact: true }).first()).toBeVisible();
    // EP-B09: nothing in the record may push the page wider than the screen. A name that is one
    // unbroken token is the case that finds it, and in RTL an overflow slides the page out from
    // under the reader rather than just adding a scrollbar.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    // The history and the form that feeds it are a task the record opens into (KPIS-B08).
    await detail.getByRole('button', { name: m.kpis.readings }).click();
    const readings = page.getByRole('dialog');
    await readings.getByRole('button', { name: m.kpis.addReadingOpen, exact: true }).click();
    await readings.getByLabel(m.kpis.reading, { exact: true }).first().fill('90');
    await readings.getByRole('button', { name: m.kpis.addReading, exact: true }).click();
    // Closing the dialog returns to the record; Escape on a phone would close the record as well.
    await readings.getByRole('button', { name: m.common.close, exact: true }).click();
    // A reading without a target is measured against nothing, and the page says which.
    await expect(detail.getByText(m.kpis.no_target, { exact: true }).first()).toBeVisible();
    await setTarget(page, id, 100);
    await page.reload();
    const panel = page.locator('aside.entity-detail');
    await expect(panel.getByText(m.kpis.near_target, { exact: true }).first()).toBeVisible();
    await page.goto(`/kpis?view=near_target&q=${encodeURIComponent(name)}`);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });
  test(`KPIS-A04 a future reading is flagged and leaves the current value alone ${locale}`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const name = `KPI ${crypto.randomUUID()}`;
    const { id } = await createKpi(page, m, name);
    await addReading(page, id, today(), 10);
    await addReading(
      page,
      id,
      new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
      999,
    );
    await page.reload();
    const panel = page.locator('aside.entity-detail');
    // The record answers with the reading that has happened, not the one dated ahead of today. The
    // unit belongs to the reader's language, so the figure is asserted the way the catalog writes
    // it rather than as an English suffix.
    await expect(panel.getByText(m.kpis.currentReading, { exact: true })).toBeVisible();
    await expect(
      panel.getByText(m.kpis.valuePoints.replace('{value}', '10'), { exact: true }).first(),
    ).toBeVisible();
    // The future reading is still in the history, flagged for what it is.
    await panel.getByRole('button', { name: m.kpis.readings }).click();
    await expect(
      page.getByRole('dialog').getByText(m.kpis.futureReading, { exact: true }),
    ).toBeVisible();
  });
}
test('KPIS-A06 changing the workspace thresholds changes statuses across the list', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const name = `KPI ${crypto.randomUUID()}`;
  const { id } = await createKpi(page, en, name);
  await addReading(page, id, today(), 90);
  await setTarget(page, id, 100);
  await page.goto(`/kpis?view=near_target&q=${encodeURIComponent(name)}`);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await setThresholds(page, '{"higher":{"on":0.9,"near":0.5},"lower":{"on":1.01,"near":1.18}}');
  await page.goto(`/kpis?view=on_target&q=${encodeURIComponent(name)}`);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await setThresholds(page, '{"higher":{"on":0.99,"near":0.85},"lower":{"on":1.01,"near":1.18}}');
});
// The thresholds editor is a page of its own (Objectives, ADMIN-B07); this scenario is about what
// the list does with a new pair, so the pair is written through the settings API.
async function setThresholds(page: Page, value: string) {
  const status = await page.evaluate(
    async (body) => {
      const response = await fetch('/api/v1/admin/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Enan',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return response.status;
    },
    { key: 'kpis.status_thresholds', value: JSON.parse(value) },
  );
  expect(status).toBe(200);
}
const createByApi = (page: Page, name: string, unit: string) =>
  page.evaluate(
    async (body) => {
      const response = await fetch('/api/v1/kpis', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Enan',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return ((await response.json()) as { data: { id: string } }).data.id;
    },
    { name, unit },
  );
test('KPIS-B26 EP-B28 the period toggle is a compact group centred over the list and switches the reading', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const name = `KPI ${crypto.randomUUID()}`;
  await createByApi(page, name, 'points');
  await page.goto(`/kpis?view=all&q=${encodeURIComponent(name)}`);
  const group = page.getByRole('group', { name: en.kpis.measuredAgainst, exact: true });
  await expect(group.getByRole('button')).toHaveText([
    en.kpis.comparePrevious,
    en.kpis.compareCurrent,
    en.kpis.compareNext,
  ]);
  await expect(group.getByRole('button', { name: en.kpis.compareCurrent })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Sized to its options from 1024 px (equal shares of the width below it), and centred.
  const box = await group.boundingBox();
  const holder = await group.locator('xpath=..').boundingBox();
  const segments = await group
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0),
    );
  expect(box && holder).toBeTruthy();
  // The track hugs its three segments (a few pixels of padding and border), however wide the list.
  expect(box!.width).toBeLessThanOrEqual(segments + 12);
  const centre = (rect: { x: number; width: number }) => rect.x + rect.width / 2;
  expect(Math.abs(centre(box!) - centre(holder!))).toBeLessThan(2);
  await group.getByRole('button', { name: en.kpis.comparePrevious }).click();
  await expect(page).toHaveURL(/period=previous/u);
  await expect(group.getByRole('button', { name: en.kpis.comparePrevious })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await group.getByRole('button', { name: en.kpis.compareNext }).click();
  await expect(page).toHaveURL(/period=next/u);
  await group.getByRole('button', { name: en.kpis.compareCurrent }).click();
  await expect(page).not.toHaveURL(/period=/u);
});
test('KPIS-B28 a percent KPI writes % on its value', async ({ page }) => {
  await loginAs(page, 'en');
  const name = `KPI ${crypto.randomUUID()}`;
  const id = await createByApi(page, name, 'percent');
  await addReading(page, id, today(), 55);
  await setTarget(page, id, 80);
  await page.goto(`/kpis?view=all&q=${encodeURIComponent(name)}`);
  const tile = page.getByRole('listitem').filter({ hasText: name }).first();
  await expect(tile).toContainText('55%');
  await expect(tile).toContainText('80%');
  await page.goto(`/kpis?view=all&id=${id}`);
  await expect(page.locator('aside.entity-detail').getByText('55%').first()).toBeVisible();
});
test('KPIS-B27 the move buttons reorder a KPI and the order is kept', async ({ page }) => {
  await loginAs(page, 'en');
  const prefix = `Order ${crypto.randomUUID().slice(0, 8)}`;
  const first = `${prefix} first`;
  const second = `${prefix} second`;
  await createByApi(page, first, 'count');
  await createByApi(page, second, 'count');
  const order = () =>
    page.evaluate(
      ([a, b]) => {
        const text = document.querySelector('main')?.innerText ?? document.body.innerText;
        return text.indexOf(a!) < text.indexOf(b!) ? 'first-second' : 'second-first';
      },
      [first, second],
    );
  await page.goto(`/kpis?view=all&q=${encodeURIComponent(prefix)}`);
  await expect(page.getByText(second, { exact: true }).first()).toBeVisible();
  expect(await order()).toBe('first-second');
  const earlier = page.getByRole('button', {
    name: en.common.moveEarlier.replace('{name}', first),
    exact: true,
  });
  await expect(earlier).toBeDisabled();
  await page
    .getByRole('button', { name: en.common.moveEarlier.replace('{name}', second), exact: true })
    .click();
  await expect(page.getByText(en.common.orderSaved, { exact: true }).last()).toBeVisible();
  expect(await order()).toBe('second-first');
  await page.reload();
  await expect(page.getByText(second, { exact: true }).first()).toBeVisible();
  expect(await order()).toBe('second-first');
});
