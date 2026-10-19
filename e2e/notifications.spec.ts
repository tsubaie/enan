import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { laneBaseURL } from './lanes';
import { fill } from './fixtures/messages';
import { credentials, loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
// Every scenario here is one member being told what another did (NOTIF-B02 makes a one-account
// run vacuous), so each provisions a fresh member through the admin API and signs them in from a
// second browser context.
type Account = { id: string; email: string; password: string };
const created = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => created.set(page, []));
test.afterEach(async ({ page }) => {
  for (const id of created.get(page) ?? []) {
    const current = await api(page, `/tasks/${id}`);
    if (current.status === 200)
      await api(page, `/tasks/${id}`, 'DELETE', { revision: current.body.data.revision });
  }
});
async function api(page: Page, path: string, method = 'GET', body?: object) {
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
      return {
        status: response.status,
        opId: response.headers.get('x-op-id'),
        body: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}
// One branch of an ICU plural message, as the catalogue writes it, with the count in place of `#`.
function plural(message: string, branch: string, count?: number) {
  const text = new RegExp(`\\b${branch} \\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, 'u').exec(message)?.[1];
  if (!text) throw new Error(`no ${branch} branch in ${message}`);
  return count === undefined ? text : fill(text.replace('#', String(count)), { count });
}
// The bell's name is the word alone at zero and the word plus the count otherwise, so the word
// finds it in either state and `exact` tells the two apart.
const bell = (page: Page, m: typeof en) =>
  page.getByRole('button', { name: m.notifications.title });
const quietBell = (page: Page, m: typeof en) =>
  page.getByRole('button', { name: m.notifications.title, exact: true });
const unreadBell = (page: Page, m: typeof en, branch: string, count?: number) =>
  page.getByRole('button', { name: plural(m.notifications.unread, branch, count), exact: true });
const centre = (page: Page) => page.getByRole('dialog');
async function loginWith(page: Page, locale: string, account: Account) {
  await page.context().addCookies([{ name: 'eos_locale', value: locale, url: laneBaseURL() }]);
  const m = locale === 'ar' ? ar : en;
  await page.goto('/login');
  await page.getByLabel(m.auth.email).fill(account.email);
  await page.getByLabel(m.auth.password).fill(account.password);
  await page.getByRole('button', { name: m.auth.login, exact: true }).click();
  await expect(page).toHaveURL(/home/);
}
// A member with an account and a directory record linked to it: the only shape that can be
// notified (NOTIF-B04). Created by the signed-in administrator through the real APIs.
async function provisionMember(page: Page) {
  const suffix = crypto.randomUUID();
  const user = await api(page, '/admin/users', 'POST', {
    name: `Member ${suffix.slice(0, 8)}`,
    email: `member-${suffix}@example.test`,
    role: 'member',
  });
  expect(user.status).toBe(201);
  const person = await createPerson(
    page,
    `Receiving Member ${suffix.slice(0, 8)}`,
    user.body.data.id,
  );
  return {
    account: {
      id: user.body.data.id,
      email: user.body.data.email,
      password: user.body.meta.temporaryPassword,
    } as Account,
    personId: person.id,
  };
}
async function createPerson(page: Page, fullName: string, userId: string | null) {
  const person = await api(page, '/people', 'POST', {
    fullName,
    displayName: null,
    honorific: null,
    organization: null,
    roleTitle: null,
    kind: userId ? 'internal' : 'external',
    email: null,
    phone: null,
    notes: null,
    tags: [],
    isAssignable: true,
    userId,
    confirmDuplicate: true,
  });
  expect(person.status).toBe(201);
  return person.body.data as { id: string };
}
async function assign(page: Page, title: string, ownerId: string) {
  const task = await api(page, '/tasks', 'POST', { title, ownerId });
  expect(task.status).toBe(201);
  created.get(page)?.push(task.body.data.id);
  return task.body.data as { id: string; revision: number };
}
async function reassign(page: Page, taskId: string, ownerId: string) {
  for (const next of [null, ownerId]) {
    const current = await api(page, `/tasks/${taskId}`);
    const patched = await api(page, `/tasks/${taskId}`, 'PATCH', {
      revision: current.body.data.revision,
      ownerId: next,
    });
    expect(patched.status).toBe(200);
  }
}
for (const locale of ['en', 'ar']) {
  const m = locale === 'ar' ? ar : en;
  test(`NOTIF-A01 NOTIF-A03 NOTIF-B09 an assignment reaches the assignee's bell and opening it lands on the task ${locale}`, async ({
    page,
    browser,
  }) => {
    await loginAs(page, locale);
    const admin = await credentials();
    const before = await bell(page, m).getAttribute('aria-label');
    const { account, personId } = await provisionMember(page);
    const title = `Board pack ${crypto.randomUUID()}`;
    const task = await assign(page, title, personId);
    const context = await browser.newContext();
    const other = await context.newPage();
    await loginWith(other, locale, account);
    // NOTIF-A01: B's bell shows one, and the row names A and the task.
    await expect(unreadBell(other, m, 'one')).toBeVisible();
    await unreadBell(other, m, 'one').click();
    const row = centre(other).getByRole('button').filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText(admin.name);
    // A's own bell is unchanged: assigning is not news to the one who assigned (NOTIF-B02).
    await page.reload();
    await expect(bell(page, m)).toHaveAttribute('aria-label', before ?? '');
    // NOTIF-A03 / NOTIF-B09: opening the row goes to the task with the record open and the badge
    // drops to zero.
    await row.click();
    await expect(other).toHaveURL(new RegExp(`/tasks\\?(?:.*&)?id=${task.id}`));
    await expect(other.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(centre(other)).toBeHidden();
    await expect(quietBell(other, m)).toBeVisible();
    await context.close();
  });
}
test('NOTIF-A02 NOTIF-B03 reassigning the same task twice leaves one unread row, at the top', async ({
  page,
  browser,
}) => {
  await loginAs(page, 'en');
  const { account, personId } = await provisionMember(page);
  const older = `Older business ${crypto.randomUUID()}`;
  await assign(page, older, personId);
  const title = `Reassigned ${crypto.randomUUID()}`;
  const task = await assign(page, title, personId);
  await reassign(page, task.id, personId);
  await reassign(page, task.id, personId);
  const context = await browser.newContext();
  const other = await context.newPage();
  await loginWith(other, 'en', account);
  await expect(unreadBell(other, en, 'other', 2)).toBeVisible();
  await unreadBell(other, en, 'other', 2).click();
  const rows = centre(other)
    .getByRole('button')
    .filter({ hasText: /business|Reassigned/u });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(title);
  await expect(rows.last()).toContainText(older);
  await context.close();
});
test('NOTIF-A04 NOTIF-B06 NOTIF-B12 a trashed task leaves the feed and the count, and comes back when restored', async ({
  page,
  browser,
}) => {
  await loginAs(page, 'en');
  const { account, personId } = await provisionMember(page);
  const title = `Trashed ${crypto.randomUUID()}`;
  const task = await assign(page, title, personId);
  const context = await browser.newContext();
  const other = await context.newPage();
  await loginWith(other, 'en', account);
  await expect(unreadBell(other, en, 'one')).toBeVisible();
  const removed = await api(page, `/tasks/${task.id}`, 'DELETE', { revision: task.revision });
  expect(removed.status).toBe(204);
  await other.reload();
  await expect(quietBell(other, en)).toBeVisible();
  await quietBell(other, en).click();
  // NOTIF-B12: nothing has arrived, and nothing is offered.
  await expect(centre(other).getByText(en.notifications.empty, { exact: true })).toBeVisible();
  await expect(centre(other).getByRole('button')).toHaveCount(0);
  await other.keyboard.press('Escape');
  // The row was hidden, not deleted: restoring the task brings it back (NOTIF-B06).
  const restored = await api(page, `/tasks/${task.id}/restore`, 'POST', { opId: removed.opId });
  expect(restored.status).toBe(200);
  await other.reload();
  await expect(unreadBell(other, en, 'one')).toBeVisible();
  await unreadBell(other, en, 'one').click();
  await expect(centre(other).getByRole('button').filter({ hasText: title })).toBeVisible();
  await context.close();
});
test('NOTIF-A05 NOTIF-A06 NOTIF-I04 nothing is written for a person without an account and nobody reads another member rows', async ({
  page,
  browser,
}) => {
  await loginAs(page, 'en');
  const { account, personId } = await provisionMember(page);
  const adviser = await createPerson(
    page,
    `External Adviser ${crypto.randomUUID().slice(0, 8)}`,
    null,
  );
  const title = `Addressed ${crypto.randomUUID()}`;
  await assign(page, title, personId);
  await assign(page, `Nobody to tell ${crypto.randomUUID()}`, adviser.id);
  const context = await browser.newContext();
  const other = await context.newPage();
  await loginWith(other, 'en', account);
  // NOTIF-A05: the assignment to the adviser produced no row for anyone; B has exactly the one.
  const mine = await api(other, '/notifications');
  expect(mine.status).toBe(200);
  expect(mine.body.data.unread).toBe(1);
  expect(mine.body.data.items.map((item: { title: string }) => item.title)).toEqual([title]);
  const [row] = mine.body.data.items as { id: string }[];
  if (!row) throw new Error('no notification for the member');
  // NOTIF-A06: A's feed never carries B's row, and A cannot mark it.
  const theirs = await api(page, '/notifications');
  expect(theirs.body.data.items.map((item: { id: string }) => item.id)).not.toContain(row.id);
  expect((await api(page, `/notifications/${row.id}/read`, 'POST', {})).status).toBe(404);
  expect((await api(other, '/notifications')).body.data.unread).toBe(1);
  const opened = await api(other, `/notifications/${row.id}/read`, 'POST', {});
  expect(opened.status).toBe(200);
  expect(opened.body.data.id).toBe(row.id);
  expect((await api(other, '/notifications')).body.data.unread).toBe(0);
  await context.close();
});
