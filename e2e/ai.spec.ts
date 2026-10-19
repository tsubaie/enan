import { expect, test } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };

for (const locale of ['en', 'ar']) {
  test(`ADMIN-B24 save, reload, replace and remove an API key (${locale})`, async ({
    page,
  }, testInfo) => {
    const messages = locale === 'ar' ? ar : en;
    let saved = false;
    let fail = false;
    await page.route('**/api/v1/admin/ai/credentials', async (route) => {
      const method = route.request().method();
      if (method === 'PUT') {
        expect(route.request().postDataJSON()).toEqual({
          apiKey: 'fixture-key',
        });
        if (fail) {
          await route.fulfill({
            status: 500,
            json: {
              error: {
                code: 'internal',
                message: 'Save failed',
                details: {},
                requestId: 'fixture',
              },
            },
          });
          return;
        }
        saved = true;
      }
      if (method === 'DELETE') saved = false;
      await route.fulfill({
        json: { data: { provider: 'openrouter', source: saved ? 'saved' : 'none' } },
      });
    });
    await loginAs(page, locale);
    await page.goto('/admin/ai');
    // ADMIN-B45: the key is one row of the Connection section; a saved key is never shown.
    await expect(
      page.getByRole('heading', { name: messages.admin.aiConnection, exact: true }),
    ).toBeVisible();
    const key = page.getByLabel(messages.admin.aiKey, { exact: true });
    const save = page.getByRole('button', { name: messages.common.save, exact: true });
    const replace = page.getByRole('button', { name: messages.admin.aiReplace, exact: true });
    const remove = page.getByRole('button', { name: messages.admin.aiRemove, exact: true });
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveValue('');
    await expect(save).toBeDisabled();
    await key.fill('fixture-key');
    await save.click();
    // Saved: the field gives way to the state in words, with Replace and Remove beside it.
    await expect(replace).toBeVisible();
    await expect(remove).toBeVisible();
    await expect(key).toHaveCount(0);
    await page.reload();
    await expect(replace).toBeVisible();
    await expect(key).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('ai-key-saved.png'), fullPage: true });
    // Replaced in place: the field comes back empty, and a refused save says why.
    fail = true;
    await replace.click();
    await expect(key).toHaveValue('');
    await key.fill('fixture-key');
    await save.click();
    await expect(page.getByText('Save failed', { exact: true })).toBeVisible();
    fail = false;
    await page.reload();
    await remove.click();
    await expect(key).toBeVisible();
    await expect(replace).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
