import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { laneBaseURL } from './lanes';
import { credentials, loginAs } from './fixtures/auth';
import { errorAlert } from './fixtures/views';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
// The browser-test administrator is shared by every spec, so anything here that changes how that
// account signs in or what it is called puts it back before the scenario ends, and recovers from a
// run that died between the change and the restore.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Reply = { status: number; body: { data?: Record<string, Json>; error?: { code: string } } };
function api(page: Page, path: string, method = 'GET', body?: object) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'ExecutiveOS',
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() } as Reply;
    },
    { path, method, body },
  );
}
const account = (page: Page) => api(page, '/account');
const revision = async (page: Page) =>
  Number((((await account(page)).body.data?.user ?? {}) as { revision: number }).revision);
// Like loginAs, but answers whether it worked instead of insisting that it did.
async function tryLogin(page: Page, locale: string, email: string, password: string) {
  const m = locale === 'ar' ? ar : en;
  await page.context().addCookies([{ name: 'eos_locale', value: locale, url: laneBaseURL() }]);
  await page.goto('/login');
  await page.getByLabel(m.auth.email).fill(email);
  await page.getByLabel(m.auth.password).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse(
      (reply) => reply.url().endsWith('/api/v1/auth/login') && reply.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    page.getByRole('button', { name: m.auth.login, exact: true }).click(),
  ]);
  if (!response.ok()) {
    await expect(errorAlert(page)).toBeVisible();
    return false;
  }
  await page.waitForURL(/home/, { timeout: 15_000 });
  return true;
}
const rotated = (password: string) => `${password}-rotated-for-ACCT-A02`;
// A password change that a crashed run never undid leaves the shared account on the rotated
// password; put it back through the same route before anything else signs in.
async function ensureKnownPassword(page: Page) {
  const admin = await credentials();
  if (await tryLogin(page, 'en', admin.email, admin.password)) return;
  expect(await tryLogin(page, 'en', admin.email, rotated(admin.password))).toBe(true);
  const restored = await api(page, '/account/password', 'POST', {
    current: rotated(admin.password),
    next: admin.password,
  });
  expect(restored.status).toBe(200);
}
async function member(page: Page) {
  const email = `member-${crypto.randomUUID()}@example.test`;
  const created = await api(page, '/admin/users', 'POST', {
    name: 'Browser Member',
    email,
    role: 'member',
  });
  expect(created.status).toBe(201);
  const body = created.body as {
    data: { id: string; revision: number };
    meta: { temporaryPassword: string };
  };
  return { id: body.data.id, email, password: body.meta.temporaryPassword };
}
async function deactivate(page: Page, id: string) {
  const users = await api(page, '/admin/users');
  const row = ((users.body.data ?? []) as { id: string; revision: number }[]).find(
    (user) => user.id === id,
  );
  if (row)
    await api(page, `/admin/users/${id}`, 'PATCH', {
      name: 'Browser Member',
      role: 'member',
      isActive: false,
      revision: row.revision,
    });
}
async function secondBrowser(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}
for (const locale of ['en', 'ar']) {
  const m = locale === 'ar' ? ar : en;
  test(`ACCT-A01 ACCT-B08 the display name is changed from the account page, reached from the avatar menu, and the shell shows it ${locale}`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const admin = await credentials();
    const name = `Reader ${crypto.randomUUID().slice(0, 8)}`;
    try {
      // ACCT-B08: the page is behind the avatar and nowhere in the navigation.
      await page.getByRole('button', { name: m.common.account, exact: true }).click();
      await page.locator('a[href="/account"]').click();
      await expect(page).toHaveURL(/\/account$/);
      expect(
        await page
          .locator('nav')
          .getByRole('link', { name: m.common.account, exact: true })
          .count(),
      ).toBe(0);
      const field = page.getByLabel(m.account.name, { exact: true });
      await field.fill(name);
      await field
        .locator('xpath=ancestor::div[.//button][1]')
        .getByRole('button', { name: m.common.save, exact: true })
        .click();
      // The page re-reads the account and the heading is the new name.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
      // The shell identity: the avatar menu.
      await page.goto('/home');
      await page.getByRole('button', { name: m.common.account, exact: true }).click();
      await expect(
        page.locator('[data-slot="popover-content"]').getByText(name, { exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      // The rail carries the destinations and the workspace's name alone (ADMIN-B19), not the reader's.
      await expect(page.locator('aside.app-sidebar').getByText(name, { exact: true })).toHaveCount(
        0,
      );
    } finally {
      const restored = await api(page, '/account', 'PATCH', {
        revision: await revision(page),
        name: admin.name,
      });
      expect(restored.status).toBe(200);
    }
  });
  test(`ACCT-A03 ACCT-B04 a locale chosen on the account page is the reader own row, and "workspace default" removes it ${locale}`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    await page.goto('/account');
    const control = page.getByRole('combobox', { name: m.account.locale, exact: true });
    await expect(control).toContainText(m.account.workspaceDefault);
    await control.click();
    await page.getByRole('option', { name: m.account.arabic, exact: true }).click();
    await expect(control).toContainText(m.account.arabic);
    const set = (await account(page)).body.data?.preferences as {
      locale: string;
      explicit: string[];
    };
    expect(set.locale).toBe('ar');
    expect(set.explicit).toContain('locale');
    // The row goes rather than being overwritten with today's workspace value (ACCT-I03).
    await control.click();
    await page.getByRole('option', { name: m.account.workspaceDefault, exact: true }).click();
    await expect(control).toContainText(m.account.workspaceDefault);
    const cleared = (await account(page)).body.data?.preferences as { explicit: string[] };
    expect(cleared.explicit).not.toContain('locale');
    await page.reload();
    await expect(page.getByRole('combobox', { name: m.account.locale, exact: true })).toContainText(
      m.account.workspaceDefault,
    );
  });
  test(`ACCT-A05 ACCT-B05 an account with no directory record is told so, and one with a record links to it ${locale}`, async ({
    page,
    browser,
  }) => {
    await loginAs(page, locale);
    // The administrator was given a directory record at setup; a fresh member has none.
    await page.goto('/account');
    await expect(page.getByText(m.account.linkedPerson, { exact: true })).toBeVisible();
    const record = page.locator('a[href^="/people?id="]');
    await expect(record).toBeVisible();
    expect(await page.getByText(m.account.noLinkedPerson, { exact: true }).count()).toBe(0);
    const created = await member(page);
    const other = await secondBrowser(browser);
    try {
      expect(await tryLogin(other.page, locale, created.email, created.password)).toBe(true);
      await other.page.goto('/account');
      await expect(other.page.getByText(m.account.noLinkedPerson, { exact: true })).toBeVisible();
      expect(await other.page.locator('a[href^="/people?id="]').count()).toBe(0);
    } finally {
      await other.context.close();
      await deactivate(page, created.id);
    }
  });
}
test('ACCT-A02 ACCT-B02 the right current password keeps this session and signs out another browser; a wrong one is reported', async ({
  page,
  browser,
}) => {
  await ensureKnownPassword(page);
  const admin = await credentials();
  const other = await secondBrowser(browser);
  await loginAs(other.page, 'en');
  let changed = false;
  try {
    await page.goto('/account');
    const current = page.getByLabel(en.account.currentPassword, { exact: true });
    const next = page.getByLabel(en.account.newPassword, { exact: true });
    const submit = page.getByRole('button', { name: en.account.changePassword, exact: true });
    await current.fill('definitely not the password');
    await next.fill(rotated(admin.password));
    await submit.click();
    await expect(errorAlert(page)).toBeVisible();
    expect(await page.getByRole('status').count()).toBe(0);
    // The other browser is still signed in: nothing changed.
    await other.page.goto('/home');
    await expect(other.page).toHaveURL(/home/);
    await current.fill(admin.password);
    await next.fill(rotated(admin.password));
    await submit.click();
    await expect(page.getByRole('status')).toContainText(/Password changed/u);
    changed = true;
    // This tab survives; the other browser is sent back to the login page.
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await other.page.goto('/home');
    await expect(other.page).toHaveURL(/login/);
    expect(await tryLogin(other.page, 'en', admin.email, admin.password)).toBe(false);
  } finally {
    await other.context.close();
    if (changed) {
      const restored = await api(page, '/account/password', 'POST', {
        current: rotated(admin.password),
        next: admin.password,
      });
      expect(restored.status).toBe(200);
    }
  }
});
test('ACCT-A04 ACCT-I01 ACCT-I02 the API has no way to name another account or to change a role', async ({
  page,
  browser,
}) => {
  await loginAs(page, 'en');
  const admin = await credentials();
  const mine = await account(page);
  expect(mine.status).toBe(200);
  expect((mine.body.data?.user as { email: string }).email).toBe(admin.email);
  // There is no parameter for "whose account": asking is a validation failure, not a 403.
  const asked = await api(page, `/account?userId=${crypto.randomUUID()}`);
  expect(asked.status).toBe(400);
  const rev = await revision(page);
  expect((await api(page, '/account', 'PATCH', { revision: rev, role: 'member' })).status).toBe(
    400,
  );
  expect((await api(page, '/account', 'PATCH', { revision: rev, isActive: false })).status).toBe(
    400,
  );
  expect((await api(page, `/account/sessions/${crypto.randomUUID()}`, 'DELETE')).status).toBe(404);
  const created = await member(page);
  const other = await secondBrowser(browser);
  try {
    expect(await tryLogin(other.page, 'en', created.email, created.password)).toBe(true);
    const theirs = await account(other.page);
    expect(theirs.body.data?.user as { id: string; role: string }).toMatchObject({
      id: created.id,
      role: 'member',
    });
    const sessions = theirs.body.data?.sessions as { id: string; current: boolean }[];
    expect(sessions.every((session) => session.current)).toBe(true);
    // The administrator's own session id is a real id and still out of reach.
    const adminSessions = mine.body.data?.sessions as { id: string }[];
    const foreign = await api(other.page, `/account/sessions/${adminSessions[0]?.id}`, 'DELETE');
    expect(foreign.status).toBe(404);
    const promote = await api(other.page, '/account', 'PATCH', { revision: 1, role: 'admin' });
    expect(promote.status).toBe(400);
    expect((await api(other.page, '/admin/settings')).status).toBe(403);
    // The administrator is still signed in and still an administrator.
    expect((await account(page)).status).toBe(200);
    expect(((await account(other.page)).body.data?.user as { role: string }).role).toBe('member');
  } finally {
    await other.context.close();
    await deactivate(page, created.id);
  }
});
