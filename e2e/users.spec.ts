import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { laneBaseURL } from './lanes';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
// The browser-test administrator is shared by every spec, so these scenarios only ever create,
// edit and deactivate accounts of their own; the shared account is never touched.
async function invite(page: Page, name: string, email: string, role: 'admin' | 'member') {
  await page.getByRole('button', { name: en.admin.addUser, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.admin.name, { exact: true }).fill(name);
  await dialog.getByLabel(en.auth.email, { exact: true }).fill(email);
  await dialog.getByLabel(en.admin.role, { exact: true }).selectOption(role);
  await dialog.getByRole('button', { name: en.admin.addUser, exact: true }).click();
  // ADMIN-B03: the temporary password is shown once, in the response, and the form is gone.
  await expect(dialog.getByText(en.admin.temporaryPassword, { exact: true })).toBeVisible();
  const password = (await dialog.locator('code').textContent()) ?? '';
  expect(password.length).toBeGreaterThan(20);
  await expect(dialog.getByLabel(en.auth.email, { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: en.common.close, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return password;
}
const row = (page: Page, email: string) => page.locator('li').filter({ hasText: email });
async function signInAs(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.context().addCookies([{ name: 'eos_locale', value: 'en', url: laneBaseURL() }]);
  await page.goto('/login');
  await page.getByLabel(en.auth.email).fill(email);
  await page.getByLabel(en.auth.password).fill(password);
  await page.getByRole('button', { name: en.auth.login, exact: true }).click();
  return page;
}
test('ADMIN-B03 an invited member signs in with the one-time password and is signed out everywhere when deactivated (en)', async ({
  page,
  browser,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin/users');
  const email = `member-${crypto.randomUUID()}@example.test`;
  const name = `Member ${crypto.randomUUID().slice(0, 8)}`;
  const password = await invite(page, name, email, 'member');
  const listed = row(page, email);
  await expect(listed.getByText(name, { exact: true })).toBeVisible();
  await expect(listed.getByText(`${en.admin.member} · ${en.common.active}`)).toBeVisible();
  // The temporary password is a real credential: the new member signs in with it elsewhere.
  const member = await signInAs(browser, email, password);
  await expect(member).toHaveURL(/home/);
  // Deactivation from the member page revokes that session.
  await listed.getByRole('button', { name: en.common.edit, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: en.common.active, exact: true }).click();
  await dialog.getByRole('button', { name: en.common.save, exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText(en.common.saved);
  await dialog.getByRole('button', { name: en.common.close, exact: true }).click();
  await expect(listed.getByText(`${en.admin.member} · ${en.common.inactive}`)).toBeVisible();
  await member.goto('/home');
  await expect(member).toHaveURL(/login/);
  // A deactivated account cannot sign back in with the password that worked a moment ago.
  await member.getByLabel(en.auth.email).fill(email);
  await member.getByLabel(en.auth.password).fill(password);
  await member.getByRole('button', { name: en.auth.login, exact: true }).click();
  await expect(member.getByRole('alert')).toBeVisible();
  await expect(member).toHaveURL(/login/);
  await member.context().close();
});
test('ADMIN-B03 ADMIN-B04 an administrator can be renamed and demoted while another administrator remains (en)', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin/users');
  const email = `admin-${crypto.randomUUID()}@example.test`;
  await invite(page, 'Second Administrator', email, 'admin');
  const listed = row(page, email);
  await expect(listed.getByText(`${en.admin.admin} · ${en.common.active}`)).toBeVisible();
  // The shared administrator is still active, so this one is not the last and may be demoted.
  await listed.getByRole('button', { name: en.common.edit, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const renamed = `Demoted ${crypto.randomUUID().slice(0, 8)}`;
  await dialog.getByLabel(en.admin.name, { exact: true }).fill(renamed);
  await dialog.getByLabel(en.admin.role, { exact: true }).selectOption('member');
  await dialog.getByRole('button', { name: en.common.save, exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText(en.common.saved);
  await dialog.getByRole('button', { name: en.common.close, exact: true }).click();
  await expect(listed.getByText(renamed, { exact: true })).toBeVisible();
  await expect(listed.getByText(`${en.admin.member} · ${en.common.active}`)).toBeVisible();
  // The row was edited against the revision it was read at; a second edit still saves.
  await listed.getByRole('button', { name: en.common.edit, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.common.save, exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText(en.common.saved);
});
