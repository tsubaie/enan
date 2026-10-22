import type { Browser, Page } from '@playwright/test';
import { z } from 'zod';
import { test, expect } from './fixtures/test';
import { laneBaseURL } from './lanes';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
// Administration as an administrator meets it: the grouped navigation, the workspace settings page,
// the AI limit in dollars, backups and the audit log. Workspace settings are shared by every spec
// that runs after this one on the same lane, so each scenario reads what it is about to change and
// puts it back before it ends.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Setting = { key: string; value: Json; default: Json };
type Reply = { status: number; body: Record<string, Json> };
function api(page: Page, path: string, method = 'GET', body?: object) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Enan',
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() } as Reply;
    },
    { path, method, body },
  );
}
async function setting(page: Page, key: string) {
  const listed = await api(page, '/admin/settings');
  const found = (listed.body.data as Setting[]).find((item) => item.key === key);
  if (!found) throw new Error(`setting ${key} is not listed`);
  return found;
}
const restore = async (page: Page, key: string, value: Json) =>
  expect((await api(page, '/admin/settings', 'PATCH', { key, value })).status).toBe(200);
const savedToast = (page: Page) => page.getByText(en.common.saved, { exact: true }).last();
const rail = (page: Page) => page.getByRole('navigation', { name: en.common.admin, exact: true });
// ADMIN-B40: the order the definition groups the pages in, which both the rail and the overview read.
const pages = [
  'settings',
  'ai',
  'users',
  'signin',
  'mail',
  'tasks',
  'notes',
  'objectives',
  'backups',
  'updates',
  'jobs',
  'audit',
] as const;

test('ADMIN-B40 @desktop the rail lists the overview, then settings, AI, members, sign-in, email, tasks, notes, objectives, then maintenance', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: en.common.admin })).toBeVisible();
  const links = rail(page).getByRole('link');
  await expect(links).toHaveText([en.admin.overview, ...pages.map((name) => en.admin[name])]);
  // The groups are headed in the order the spec names them.
  await expect(rail(page).getByRole('heading')).toHaveText([
    en.admin.groupWorkspace,
    en.admin.groupContent,
    en.admin.groupMaintenance,
  ]);
  await expect(rail(page).getByRole('link', { name: en.admin.overview })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await rail(page).getByRole('link', { name: en.admin.backups, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/backups$/u);
  await expect(page.getByRole('heading', { level: 1, name: en.admin.backups })).toBeVisible();
  await expect(
    rail(page).getByRole('link', { name: en.admin.backups, exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

test('ADMIN-B39 ADMIN-B40 the overview links every administration page, in the rail order, and each opens its page', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin');
  const index = page.locator('section[aria-labelledby^="admin-index-"]');
  await expect(index).toHaveCount(3);
  const hrefs = await index
    .locator('a')
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
  expect(hrefs).toEqual(pages.map((name) => `/admin/${name}`));
  for (const name of ['settings', 'audit'] as const) {
    await page.goto('/admin');
    // During the page transition the outgoing page can still hold its own overview; wait until
    // only the new one is there.
    await expect(index).toHaveCount(3);
    await index.locator(`a[href="/admin/${name}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${name}$`, 'u'));
    await expect(page.getByRole('heading', { level: 1, name: en.admin[name] })).toBeVisible();
  }
});

test('ADMIN-B40 on a phone the overview is the index and every page links back to it @mobile', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin');
  // No rail below lg: the overview's index is the navigation.
  await expect(rail(page)).toBeHidden();
  const link = page.locator('section[aria-labelledby^="admin-index-"] a[href="/admin/backups"]');
  // Just after a navigation the outgoing page can still hold its own overview; wait for one.
  await expect(link).toHaveCount(1);
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: en.admin.backups })).toBeVisible();
  await expect(page.getByRole('button', { name: en.admin.createBackup })).toBeVisible();
  const back = page.getByRole('link', { name: en.common.admin, exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/admin$/u);
  // Nothing on the page is pushed past the screen's edge.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ADMIN-B07 @desktop renaming the workspace updates the name beside the logo without a reload', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const before = await setting(page, 'workspace.name');
  const name = `Office ${crypto.randomUUID().slice(0, 8)}`;
  const brand = page.locator('aside.app-sidebar a[href="/home"]').first();
  try {
    await page.goto('/admin/settings');
    await expect(brand).toHaveText(String(before.value));
    // A marker on the window survives a re-render and not a reload.
    await page.evaluate(() => ((window as Window & { kept?: boolean }).kept = true));
    const field = page.getByLabel(en.admin.settingsName, { exact: true });
    await expect(field).toHaveValue(String(before.value));
    await field.fill(name);
    await field.press('Tab');
    await expect(savedToast(page)).toBeVisible();
    await expect(brand).toHaveText(name);
    expect(await page.evaluate(() => (window as Window & { kept?: boolean }).kept)).toBe(true);
    expect((await setting(page, 'workspace.name')).value).toBe(name);
  } finally {
    await restore(page, 'workspace.name', before.value);
  }
});

test('ADMIN-B07 ADMIN-B48 the numerals switch re-renders the page in the chosen digits', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const before = await setting(page, 'workspace.arabic_numerals');
  const account = await api(page, '/account');
  // A reader's own numerals would win over the workspace's; this administrator has none.
  const explicit = (account.body.data as { preferences: { explicit: string[] } }).preferences
    .explicit;
  expect(explicit).not.toContain('numerals');
  const field = page.getByLabel(en.admin.settingsTrashDays, { exact: true });
  try {
    await restore(page, 'workspace.arabic_numerals', false);
    await page.goto('/admin/settings');
    const numerals = page.getByRole('group', { name: en.admin.settingsNumerals, exact: true });
    await expect(numerals.getByRole('button', { name: '123' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(field).toHaveAccessibleDescription(/^0 /u);
    await numerals.getByRole('button', { name: '١٢٣' }).click();
    await expect(savedToast(page)).toBeVisible();
    await expect(numerals.getByRole('button', { name: '١٢٣' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The hint's 0 is written in the reader's numerals (ADMIN-B48), so it follows the switch.
    await expect(field).toHaveAccessibleDescription(/^٠ /u);
    expect((await setting(page, 'workspace.arabic_numerals')).value).toBe(true);
  } finally {
    await restore(page, 'workspace.arabic_numerals', before.value);
  }
});

const retention = [
  {
    key: 'retention.trash_days',
    label: en.admin.settingsTrashDays,
    hint: en.admin.settingsTrashHint,
    never: en.admin.settingsTrashNever,
    unit: en.admin.unitDays,
  },
  {
    key: 'retention.meeting_files_days',
    label: en.admin.settingsFilesDays,
    hint: en.admin.settingsFilesHint,
    never: en.admin.settingsFilesNever,
    unit: en.admin.unitDays,
  },
  {
    key: 'retention.backup_count',
    label: en.admin.settingsBackupCount,
    hint: en.admin.settingsBackupsHint,
    never: en.admin.settingsBackupsNever,
    unit: en.admin.unitBackups,
  },
];
test('ADMIN-B48 each retention row says 0 means never, accepts 0 and says so in words, and refuses -1', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const before = await Promise.all(retention.map((row) => setting(page, row.key)));
  try {
    for (const row of retention) await restore(page, row.key, 5);
    await page.goto('/admin/settings');
    for (const row of retention) {
      const field = page.getByLabel(row.label, { exact: true });
      const unit = field.locator('xpath=following-sibling::span[1]');
      await expect(field).toHaveValue('5');
      await expect(field).toHaveAccessibleDescription(
        row.hint.replace('{zero, number, integer}', '0'),
      );
      await expect(unit).toHaveText(row.unit);
      await field.fill('0');
      // The state in words replaces the unit while the field holds 0.
      await expect(unit).toHaveText(row.never);
      await field.press('Tab');
      await expect.poll(async () => (await setting(page, row.key)).value).toBe(0);
      await field.fill('-1');
      await field.press('Tab');
      await expect(field).toHaveValue('0');
      // An empty field is not 0 either: it is put back.
      await field.fill('');
      await field.press('Tab');
      await expect(field).toHaveValue('0');
      expect((await setting(page, row.key)).value).toBe(0);
    }
    await page.reload();
    for (const row of retention) {
      await expect(page.getByLabel(row.label, { exact: true })).toHaveValue('0');
      await expect(page.getByText(row.never, { exact: true }).first()).toBeVisible();
    }
  } finally {
    for (const [index, row] of retention.entries())
      await restore(page, row.key, before[index]!.value);
  }
});

type Controls = { enabledCapabilities: string[]; monthlyBudgetMicros: number | null };
test('ADMIN-B45 ADMIN-B10 ADMIN-B26 the monthly AI limit is typed in dollars, saved on blur and cleared to no limit', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const controls = async () => (await api(page, '/admin/ai/controls')).body.data as Controls;
  const before = await controls();
  try {
    await page.goto('/admin/ai');
    await expect(page.getByRole('heading', { name: en.admin.aiFeatures })).toBeVisible();
    const field = page.getByLabel(en.admin.aiLimit, { exact: true });
    await expect(field.locator('xpath=following-sibling::span[1]')).toHaveText(
      en.admin.aiLimitUnit,
    );
    await expect(field).toHaveAttribute('placeholder', en.admin.aiNoLimit);
    await field.fill('12.34');
    // Nothing is sent while the field is being typed in.
    expect((await controls()).monthlyBudgetMicros).toBe(before.monthlyBudgetMicros);
    await field.press('Tab');
    await expect(savedToast(page)).toBeVisible();
    await expect.poll(async () => (await controls()).monthlyBudgetMicros).toBe(12_340_000);
    await page.reload();
    await expect(page.getByLabel(en.admin.aiLimit, { exact: true })).toHaveValue('12.34');
    await page.getByLabel(en.admin.aiLimit, { exact: true }).fill('');
    // Blank is no limit: the save goes through like any other.
    const cleared = page.waitForResponse(
      (reply) =>
        reply.url().endsWith('/api/v1/admin/ai/controls') && reply.request().method() === 'PUT',
    );
    await page.getByLabel(en.admin.aiLimit, { exact: true }).press('Tab');
    expect((await cleared).status()).toBe(200);
    await expect.poll(async () => (await controls()).monthlyBudgetMicros).toBeNull();
    await page.reload();
    await expect(page.getByLabel(en.admin.aiLimit, { exact: true })).toHaveValue('');
  } finally {
    const now = await controls();
    if (
      now.monthlyBudgetMicros !== before.monthlyBudgetMicros ||
      now.enabledCapabilities.join() !== before.enabledCapabilities.join()
    ) {
      const restored = await api(page, '/admin/ai/controls', 'PUT', {
        enabledCapabilities: before.enabledCapabilities,
        monthlyBudgetMicros: before.monthlyBudgetMicros,
      });
      // Soft, so a failure above is the one reported rather than this one.
      expect.soft(restored.status).toBe(200);
    }
  }
});

async function member(page: Page, browser: Browser) {
  const email = `member-${crypto.randomUUID()}@example.test`;
  const created = await api(page, '/admin/users', 'POST', {
    name: 'Backup Member',
    email,
    role: 'member',
  });
  expect(created.status).toBe(201);
  const password = (created.body.meta as { temporaryPassword: string }).temporaryPassword;
  const context = await browser.newContext({ baseURL: laneBaseURL() });
  const other = await context.newPage();
  await context.addCookies([{ name: 'eos_locale', value: 'en', url: laneBaseURL() }]);
  await other.goto('/login');
  await other.getByLabel(en.auth.email).fill(email);
  await other.getByLabel(en.auth.password).fill(password);
  await other.getByRole('button', { name: en.auth.login, exact: true }).click();
  await expect(other).toHaveURL(/home/u);
  return { context, page: other, id: (created.body.data as { id: string }).id };
}

const Backups = z.object({
  data: z.array(z.object({ id: z.string() })),
  meta: z.object({
    runner: z.boolean(),
    job: z.object({ id: z.string(), status: z.string() }).nullable(),
  }),
});
test('ADMIN-B12 ADMIN-B44 ADMIN-B46 ADMIN-B41 a backup is created with its progress told, downloads as a tar, restore is coming soon, and a member is refused', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await loginAs(page, 'en');
  const list = async () => Backups.parse((await api(page, '/admin/backups')).body);
  const before = await list();
  await page.goto('/admin/backups');
  // ADMIN-B41: no server command, a calm notice.
  const restore = page.getByRole('region', { name: en.admin.restoreTitle });
  await expect(restore.getByText(en.admin.restoreSoon, { exact: true })).toBeVisible();
  await expect(restore.getByText(en.admin.restoreComingSoon, { exact: true })).toBeVisible();
  const create = page.getByRole('button', { name: en.admin.createBackup });
  await expect(create).toBeEnabled();
  await create.click();
  if (!before.meta.runner) {
    // ADMIN-B46: a server that runs no jobs says the backup will not be made, not that it will.
    await expect(
      page.getByRole('status').filter({ hasText: en.admin.backupWaitingRunnerOff }),
    ).toBeVisible();
    await expect(create).toBeDisabled();
  } else {
    await expect(
      page.getByRole('status').filter({
        hasText: new RegExp(
          `${en.admin.backupInProgress}|${en.admin.backupStarted}|${en.admin.backupFinished}`,
          'u',
        ),
      }),
    ).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: en.admin.backupFinished })).toBeVisible(
      { timeout: 60_000 },
    );
    await expect(create).toBeEnabled();
    const after = await list();
    expect(after.data.length).toBeGreaterThan(before.data.length);
    const newest = after.data.find((row) => !before.data.some((old) => old.id === row.id));
    expect(newest).toBeDefined();
    // ADMIN-B44: Download is offered with its size and answers with one tar.
    const link = page.locator(`a[href="/api/v1/admin/backups/${newest!.id}/download"]`);
    await expect(link).toContainText(en.admin.backupDownload);
    await expect(link).toContainText(/MB/u);
    const download = await page.request.get(`/api/v1/admin/backups/${newest!.id}/download`);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toContain('tar');
    expect(download.headers()['content-disposition']).toMatch(/\.tar/u);
    const body = await download.body();
    // A POSIX tar header carries "ustar" at offset 257 of its first block.
    expect(body.subarray(257, 262).toString('latin1')).toBe('ustar');
    const other = await member(page, browser);
    try {
      expect(
        (await other.page.request.get(`/api/v1/admin/backups/${newest!.id}/download`)).status(),
      ).toBe(403);
    } finally {
      await other.context.close();
    }
  }
  const other = await member(page, browser);
  try {
    expect((await api(other.page, '/admin/backups')).status).toBe(403);
    expect((await api(other.page, '/admin/backups', 'POST', {})).status).toBe(403);
    await other.page.goto('/admin/backups');
    await expect(other.page.getByRole('button', { name: en.admin.createBackup })).toHaveCount(0);
  } finally {
    await other.context.close();
  }
});

test('ADMIN-B43 a settings change reads in the audit log as words, not as raw keys', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const before = await setting(page, 'retention.trash_days');
  const days = before.value === 41 ? 42 : 41;
  try {
    await restore(page, 'retention.trash_days', days);
    await page.goto('/admin/audit');
    const today = page.getByRole('region', { name: en.admin.auditToday, exact: true });
    const entry = today.getByRole('listitem').filter({
      hasText: en.admin.auditEvent
        .replace('{action}', en.admin.auditAction_update)
        .replace('{entity}', en.admin.auditEntity_setting),
    });
    const change = entry.filter({ hasText: `${en.admin.settingsTrashDays}:` }).first();
    await expect(change).toBeVisible();
    await expect(change).toContainText(String(days));
    // The key and the raw action never reach the reader.
    await expect(today).not.toContainText('retention.trash_days');
    await expect(today).not.toContainText('update setting');
  } finally {
    await restore(page, 'retention.trash_days', before.value);
  }
});

test('ADMIN-B60 ADMIN-B61 a mail server saved on the Email page keeps its password hidden and a failed test says why', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin/mail');
  await expect(page.getByRole('heading', { level: 1, name: en.admin.mail })).toBeVisible();
  // A port nothing listens on: the real client is refused, so the page must name the cause.
  await page.getByLabel(en.admin.mailHost).fill('127.0.0.1');
  await page.getByLabel(en.admin.mailPort).fill('1');
  await page.getByLabel(en.admin.mailUsername).fill('sender@example.test');
  await page.getByLabel(en.admin.mailPassword).fill('e2e-mail-password');
  await page.getByLabel(en.admin.mailFrom).fill('office@example.test');
  await page.getByRole('button', { name: en.common.save, exact: true }).click();
  await expect(page.getByText(en.admin.mailSaved)).toBeVisible();
  await expect(page.getByText(en.admin.mailPasswordKept)).toBeVisible();
  await expect(page.getByLabel(en.admin.mailPassword)).toHaveValue('');
  const status = await api(page, '/admin/mail');
  expect(JSON.stringify(status.body)).not.toContain('e2e-mail-password');
  await page.getByRole('button', { name: en.admin.mailSendTest }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: en.admin.mailError_network }),
  ).toBeVisible();
  await page.getByRole('button', { name: en.admin.mailRemove }).click();
  await expect(page.getByText(en.admin.mailNotSetUp)).toBeVisible();
});

test('ADMIN-B64 ADMIN-B63 the workspace offers an emailed code once mail is set up, and can turn password sign-in off', async ({
  page,
  browser,
}) => {
  await loginAs(page, 'en');
  await page.goto('/admin/signin');
  const box = (name: string) => page.getByRole('checkbox', { name });
  await expect(page.getByRole('link', { name: en.admin.signInNeedsMail })).toBeVisible();
  await expect(box(en.admin.signInMethod_code)).toBeDisabled();
  // A mail server nobody listens on: enough for the method to be servable, and nothing is sent.
  const saved = await api(page, '/admin/mail', 'PUT', {
    host: '127.0.0.1',
    port: 1,
    username: '',
    password: '',
    fromAddress: 'office@example.test',
  });
  expect(saved.status).toBe(200);
  await page.reload();
  await expect(box(en.admin.signInMethod_code)).toBeChecked();
  const visitor = await browser.newContext({ baseURL: laneBaseURL() });
  await visitor.addCookies([{ name: 'eos_locale', value: 'en', url: laneBaseURL() }]);
  const login = await visitor.newPage();
  try {
    await login.goto('/login');
    await login.getByRole('link', { name: en.auth.codeLink }).click();
    await expect(login).toHaveURL(/\/login\/code$/u);
    await login.getByLabel(en.auth.email).fill('stranger@example.test');
    await login.getByRole('button', { name: en.auth.codeSend }).click();
    await expect(login.getByLabel(en.auth.code)).toBeVisible();
    // Password off: the form is gone and the API refuses a password even with the right one.
    await box(en.admin.signInMethod_password).click();
    await expect(page.getByText(en.admin.signInSaved)).toBeVisible();
    await expect(box(en.admin.signInMethod_code)).toBeDisabled();
    await login.goto('/login');
    await expect(login.getByLabel(en.auth.password)).toHaveCount(0);
    await expect(login.getByRole('link', { name: en.auth.codeLink })).toBeVisible();
    const refused = await login.request.post('/api/v1/auth/login', {
      headers: { Origin: laneBaseURL(), 'X-Requested-With': 'Enan' },
      data: { email: 'stranger@example.test', password: 'whatever-it-is' },
    });
    expect(refused.status()).toBe(403);
  } finally {
    await box(en.admin.signInMethod_password).click();
    await expect(box(en.admin.signInMethod_password)).toBeChecked();
    expect((await api(page, '/admin/mail', 'DELETE', {})).status).toBe(200);
    await visitor.close();
  }
});
