import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import { commandsLeft, commandsSent, updaterWrote } from './fixtures/updater';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };

// ADMIN-B57, ADMIN-B58, ADMIN-B67, ADMIN-B68: Administration → Updates against the production
// build, with the files the updater service would have written (its own behaviour is tested in
// updater/).
const status = (fields: object) => ({
  channel: 'latest',
  state: 'checked',
  running: { version: '1.1.0', revision: 'abcdef1234567' },
  lastCheckAt: new Date().toISOString(),
  paused: false,
  automatic: false,
  confirm: false,
  timeZone: 'UTC',
  intervalSeconds: 900,
  ...fields,
});
const restore = 'docker compose exec app pnpm backup:restore /var/lib/enan/backups/b-9 --confirm';
const rolledBack = status({
  state: 'rolled_back',
  step: 'verify',
  error: 'the container stopped',
  candidate: { version: '1.2.0', revision: '9999999aaaaaa' },
  backup: 'b-9',
  restoreCommand: restore,
  finishedAt: new Date().toISOString(),
});

test.afterEach(() => updaterWrote(null));

for (const locale of ['en', 'ar'] as const) {
  const m = locale === 'ar' ? ar : en;
  test(`ADMIN-B57 without the updater the page says it is not running (${locale})`, async ({
    page,
  }) => {
    await updaterWrote(null);
    await loginAs(page, locale);
    await page.goto('/admin/updates');
    await expect(page.getByRole('heading', { name: m.admin.updaterNotRunning })).toBeVisible();
    await expect(page.getByText('docker compose up -d updater')).toBeVisible();
    await expect(page.getByRole('button', { name: m.admin.updateCheckNow })).toHaveCount(0);
  });

  test(`ADMIN-B57 ADMIN-B58 a rolled back update shows its restore command, and Check now reaches the updater (${locale})`, async ({
    page,
  }) => {
    await updaterWrote(rolledBack, [rolledBack]);
    await loginAs(page, locale);
    await page.goto('/admin/updates');
    await expect(
      page.getByRole('heading', { name: m.admin.updateOutcomeRolledBack }),
    ).toBeVisible();
    // The command wraps instead of running off the panel, so it is copied whole.
    const command = page.getByText(restore);
    await expect(command).toBeVisible();
    const box = await command.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await page.getByRole('button', { name: m.admin.updateCheckNow }).click();
    await expect(page.getByRole('status')).toBeVisible();
    await expect.poll(commandsLeft).toHaveLength(1);
  });

  test(`ADMIN-B67 a release you cannot go back from is installed after its confirmation (${locale})`, async ({
    page,
  }) => {
    const digest = `sha256:${'c'.repeat(64)}`;
    await updaterWrote(
      status({ state: 'available', confirm: true, candidate: { version: '2027.1.0', digest } }),
    );
    await loginAs(page, locale);
    await page.goto('/admin/updates');
    await expect(page.getByRole('heading', { name: m.admin.updateAvailableTitle })).toBeVisible();
    await page.getByRole('button', { name: m.admin.updateInstallNow }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(m.admin.updateConfirmBody)).toBeVisible();
    expect(await commandsLeft()).toHaveLength(0);
    await dialog.getByRole('button', { name: m.admin.updateConfirmInstall }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(commandsSent).toEqual([{ command: 'install', digest, confirm: true }]);
  });

  test(`ADMIN-B68 automatic installing is turned on from the page (${locale})`, async ({
    page,
  }) => {
    await updaterWrote(status({}));
    await loginAs(page, locale);
    await page.goto('/admin/updates');
    const toggle = page.getByRole('checkbox', { name: m.admin.updateAutomatic });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await page.getByLabel(m.admin.updateWindowFrom, { exact: true }).fill('02:00');
    await page.getByLabel(m.admin.updateWindowTo, { exact: true }).fill('05:00');
    await page.getByRole('button', { name: m.admin.updateAutomaticSave }).click();
    await expect
      .poll(commandsSent)
      .toEqual([{ command: 'settings', automatic: true, window: '02:00-05:00' }]);
  });
}

test("ADMIN-B57 the updater's status is not public", async ({ request }) => {
  await updaterWrote(status({}));
  expect((await request.get('/api/v1/admin/updates')).status()).toBe(401);
});
