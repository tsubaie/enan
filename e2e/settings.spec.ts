import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import { errorAlert } from './fixtures/views';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
// Workspace settings are shared by every spec that runs after this one, so each scenario reads the
// value it is about to change and puts it back before it ends.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Setting = { key: string; value: Json; default: Json; type: string };
function api(page: Page, method = 'GET', body?: object) {
  return page.evaluate(
    async ({ method, body }) => {
      const response = await fetch('/api/v1/admin/settings', {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'ExecutiveOS',
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, body },
  );
}
async function setting(page: Page, key: string) {
  const listed = await api(page);
  const found = (listed.body.data as Setting[]).find((item) => item.key === key);
  if (!found) throw new Error(`setting ${key} is not listed`);
  return found;
}
const restore = (page: Page, key: string, value: Json) => api(page, 'PATCH', { key, value });
const saved = (page: Page, m: typeof en) => page.getByText(m.common.saved, { exact: true }).last();
for (const locale of ['en', 'ar']) {
  const m = locale === 'ar' ? ar : en;
  test(`ADMIN-B07 a workspace setting is edited in its plain-language row, saved on leaving the field, kept across a reload and reset to its default ${locale}`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const before = await setting(page, 'workspace.name');
    const name = `Office ${crypto.randomUUID().slice(0, 8)}`;
    try {
      await page.goto('/admin/settings');
      await expect(page.getByText(m.admin.settingsDescription, { exact: true })).toBeVisible();
      // The row is named in words; the registry key is nowhere on the page.
      await expect(page.getByText('workspace.name')).toHaveCount(0);
      const field = page.getByLabel(m.admin.settingsName, { exact: true });
      await expect(field).toHaveValue(String(before.value));
      await field.fill(name);
      await field.press('Tab');
      await expect(saved(page, m)).toBeVisible();
      await expect.poll(async () => (await setting(page, 'workspace.name')).value).toBe(name);
      await page.reload();
      await expect(page.getByLabel(m.admin.settingsName, { exact: true })).toHaveValue(name);
      // A row away from its default offers the way back to it, which the control then shows.
      await page
        .getByRole('button', {
          name: m.admin.resetNamed.replace('{name}', m.admin.settingsName),
          exact: true,
        })
        .click();
      await expect(page.getByLabel(m.admin.settingsName, { exact: true })).toHaveValue(
        String(before.default),
      );
      await expect
        .poll(async () => (await setting(page, 'workspace.name')).value)
        .toBe(before.default);
    } finally {
      expect((await restore(page, 'workspace.name', before.value)).status).toBe(200);
    }
  });
}
test('ADMIN-B07 ADMIN-B48 a value out of range is put back in the row and refused by the registry, and nothing is stored', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const before = await setting(page, 'retention.trash_days');
  await page.goto('/admin/settings');
  const field = page.getByLabel(en.admin.settingsTrashDays, { exact: true });
  await expect(field).toHaveValue(String(before.value));
  // Out of range: the row puts its value back rather than sending it.
  await field.fill('4000');
  await field.press('Tab');
  await expect(field).toHaveValue(String(before.value));
  // The registry is the last word whatever the page lets through.
  const refused = await restore(page, 'retention.trash_days', -1);
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(refused.status).toBeLessThan(500);
  expect((await setting(page, 'retention.trash_days')).value).toBe(before.value);
  await page.reload();
  await expect(page.getByLabel(en.admin.settingsTrashDays, { exact: true })).toHaveValue(
    String(before.value),
  );
});
const thresholdField = (direction: 'thresholdHigher' | 'thresholdLower', status: string) =>
  en.admin.thresholdField.replace('{direction}', en.admin[direction]).replace('{status}', status);
test('ADMIN-B07 ADMIN-B09 the thresholds are edited on Objectives as percentages, validated as ordered bands, and an accepted value is what the page shows afterwards', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const before = await setting(page, 'kpis.status_thresholds');
  try {
    await restore(page, 'kpis.status_thresholds', before.default);
    await page.goto('/admin/objectives');
    await expect(page.getByText(en.admin.settingsKpis, { exact: true })).toBeVisible();
    const on = page.getByLabel(thresholdField('thresholdHigher', en.admin.thresholdOnStart), {
      exact: true,
    });
    const defaults = before.default as { higher: { on: number; near: number } };
    await expect(on).toHaveValue(String(Math.round(defaults.higher.on * 1000) / 10));
    // On target may not start below where near target starts.
    await on.fill(String(Math.round(defaults.higher.near * 100) - 10));
    await on.press('Tab');
    await expect(errorAlert(page).first()).toBeVisible();
    expect((await setting(page, 'kpis.status_thresholds')).value).toEqual(before.default);
    await on.fill('97.5');
    await on.press('Tab');
    await expect(page.getByText(en.common.saved, { exact: true }).last()).toBeVisible();
    await expect
      .poll(
        async () =>
          ((await setting(page, 'kpis.status_thresholds')).value as typeof defaults).higher.on,
      )
      .toBe(0.975);
    await page.reload();
    await expect(
      page.getByLabel(thresholdField('thresholdHigher', en.admin.thresholdOnStart), {
        exact: true,
      }),
    ).toHaveValue('97.5');
  } finally {
    expect((await restore(page, 'kpis.status_thresholds', before.value)).status).toBe(200);
  }
});
