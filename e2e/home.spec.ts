import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { createTranslator } from 'next-intl';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
import { addDays } from '../src/core/time/days';
import { personDraft } from '../src/modules/people/schema/validation';

// HOME-B13: a grid item does not shrink below its own min-content, and a committee named after a
// UUID has no break in it, so the column grew past its track and carried every section's "View
// all" off the end of the screen. The `lg` template already said `minmax(0, …)`; the implicit
// single column of a phone needed saying too.
//
// The assertion is on the columns and on the one control the overflow takes away. Sweeping the
// whole subtree for boxes past the edge does not work here: the shell root is `overflow-hidden`,
// so every overflowing box has a clipping ancestor and a filter written that way passes whatever
// the page does.
for (const locale of ['en', 'ar'] as const) {
  test(`HOME-B13 no section runs past the end of a phone screen (${locale})`, async ({ page }) => {
    const m = locale === 'ar' ? ar : en;
    await loginAs(page, locale);
    // An empty section has no tile (HOME-B02), so the page is given one: a task due today puts the
    // Actions tile, and its "View all", on screen whatever the other scenarios left behind.
    const { today } = await homePayload(page);
    await task(page, `Phone width ${crypto.randomUUID()}`, { dueDate: today });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/home');
    // The grid and every tile in it (HOME-B15: the tiles are the grid's own children).
    const columns = page.locator('.home-column, .home-column > *');
    await expect(columns.first()).toBeVisible();
    const boxes = await columns.evaluateAll((nodes) =>
      nodes.map((node) => ({
        left: Math.round(node.getBoundingClientRect().left),
        right: Math.round(node.getBoundingClientRect().right),
        limit: window.innerWidth,
      })),
    );
    expect(boxes.length).toBeGreaterThan(0);
    // RTL overflows towards zero rather than past the far edge, so both sides are checked.
    for (const column of boxes) {
      expect(column.right).toBeLessThanOrEqual(column.limit);
      expect(column.left).toBeGreaterThanOrEqual(-1);
    }

    // Every section's way into the module has to be reachable, which is what the overflow removed.
    // The axis under test is the horizontal one: a link further down the page is off screen
    // because the page scrolls, which is not the defect.
    const links = page.getByRole('link', { name: m.home.viewAll, exact: true });
    await expect(links.first()).toBeVisible();
    const past = await links.evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.right > window.innerWidth + 1 || box.left < -1;
        })
        .map((node) => Math.round(node.getBoundingClientRect().right)),
    );
    expect(past).toEqual([]);
  });
}

// The scenarios below set their data up through the API, the way the kpis and notes suites do, so
// the browser's time goes on what the page shows. Everything created is removed afterwards:
// Home aggregates the whole workspace, so a leftover task would move another run's counts.
type Body = { data?: { id: string; revision: number } };
const created = new WeakMap<Page, { resource: string; id: string }[]>();
test.beforeEach(({ page }) => {
  const records: { resource: string; id: string }[] = [];
  created.set(page, records);
  page.on('response', (response) => {
    const match = /\/api\/v1\/(tasks|committees|people)$/u.exec(new URL(response.url()).pathname);
    if (response.status() === 201 && match?.[1])
      void response.json().then((body: Body) => {
        if (body.data?.id) records.push({ resource: String(match[1]), id: body.data.id });
      });
  });
});
test.afterEach(async ({ page }) => {
  for (const { resource, id } of (created.get(page) ?? []).reverse()) {
    const current = await api(page, resource, `/${id}`);
    if (current.status === 200)
      await api(page, resource, `/${id}`, 'DELETE', { revision: current.body.data.revision });
  }
});
async function api(page: Page, resource: string, path: string, method = 'GET', body?: object) {
  return page.evaluate(
    async ({ resource, path, method, body }) => {
      const response = await fetch(`/api/v1/${resource}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'ExecutiveOS',
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body:
          response.status === 204
            ? { opId: response.headers.get('x-op-id') }
            : await response.json(),
      };
    },
    { resource, path, method, body },
  );
}
type HomeSection = {
  key: string;
  count: number;
  days: { date: string; count: number }[] | null;
};
// The aggregate as the page receives it: the workspace's today and the counts the sections carry
// before a scenario adds to them, so expectations are stated relative to whatever else is there.
async function homePayload(page: Page) {
  const response = await api(page, 'home', '');
  const sections: HomeSection[] = response.body.data.sections;
  const section = (key: string) => {
    const found = sections.find((item) => item.key === key);
    if (!found) throw new Error(`home section ${key} missing`);
    return found;
  };
  const today = section('today').days?.[0]?.date;
  if (!today) throw new Error('home payload carries no week');
  return { today, section };
}
const task = async (page: Page, title: string, fields: object = {}) =>
  (await api(page, 'tasks', '', 'POST', { title, ...fields })).body.data;
// Catalogue messages with plurals, rendered the way the app renders them; Arabic-Indic digits are
// folded to Latin on both sides so a numbering preference cannot decide the comparison.
const translator = (locale: 'en' | 'ar') =>
  createTranslator({ locale, messages: locale === 'ar' ? ar : en });
const latin = (text: string | null) =>
  (text ?? '').replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x660));
for (const locale of ['en', 'ar'] as const) {
  const m = locale === 'ar' ? ar : en;
  const t = translator(locale);
  test(`HOME-A01 HOME-A04 HOME-A05 HOME-A07 the rows state their facts and every "View all" opens the matching view (${locale})`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const { today } = await homePayload(page);
    const suffix = crypto.randomUUID();
    const committeeName = `Committee ${suffix}`;
    const committee = (await api(page, 'committees', '', 'POST', { name: committeeName })).body
      .data;
    const holderName = `Holder ${suffix}`;
    const holder = (
      await api(page, 'people', '', 'POST', {
        ...personDraft(holderName),
        kind: 'internal',
        isAssignable: true,
      })
    ).body.data;
    // Ten years late sorts first among whatever else is overdue, so the row is on the page.
    const daysLate = 3650;
    const lateTitle = `Late letter ${suffix}`;
    await task(page, lateTitle, { dueDate: addDays(today, -daysLate), committeeId: committee.id });
    await task(page, `Open memo ${suffix}`, { committeeId: committee.id });
    await task(page, `Awaiting reply ${suffix}`, { status: 'waiting_on', ownerId: holder.id });
    await task(page, `Awaiting figures ${suffix}`, { status: 'waiting_on', ownerId: holder.id });
    await page.goto('/home');
    // HOME-A05: an overdue row states how many days late it is.
    const late = page.getByRole('link', { name: lateTitle });
    await expect(late).toBeVisible();
    // The span of days is marked up (<n>) so only it takes the danger ink; the words are the same.
    await expect(late).toContainText(
      t.markup('home.daysLate', { count: daysLate, n: (chunks) => chunks }),
    );
    // HOME-A05, HOME-A07: a waiting row names the holder, with one row carrying their count.
    const holding = page.getByRole('link', { name: holderName });
    await expect(holding).toBeVisible();
    await expect(holding.locator('..')).toContainText(t('home.holding', { count: 2 }));
    // HOME-A05, HOME-A07: the committee states its open work and its late share.
    const row = page.locator('a[href^="/committees?"]').filter({ hasText: committeeName });
    await expect(row).toBeVisible();
    await expect(row).toContainText(t('home.openWork', { count: 2 }));
    await expect(row).toContainText(t('home.lateOpen', { count: 1 }));
    // HOME-A01: every "View all" is a module view, and the Actions block's is the today view.
    const links = page.getByRole('link', { name: m.home.viewAll, exact: true });
    const hrefs = await links.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href')),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs)
      expect(href).toMatch(/^\/(?:tasks|committees|kpis|notes)\?view=[a-z_]+$/u);
    expect(hrefs).toContain('/tasks?view=today');
    expect(hrefs).toContain('/committees?view=open');
    // HOME-A04: the committee section's own link opens Committees in the open view.
    await page
      .locator('section', {
        has: page.getByRole('heading', { name: m.home.committees, exact: true }),
      })
      .getByRole('link', { name: m.home.viewAll, exact: true })
      .click();
    await expect(page).toHaveURL(/\/committees\?view=open/u);
    await expect(page.getByText(committeeName, { exact: true }).first()).toBeVisible();
  });
  test(`HOME-A08 HOME-B14 the week shows seven cells from today with the day's counts and an overdue cell (${locale})`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const before = await homePayload(page);
    const baseline = before.section('today').days ?? [];
    const overdueBefore = before.section('overdue').count;
    const plus = (days: number) => addDays(before.today, days);
    const suffix = crypto.randomUUID();
    await task(page, `Now ${suffix}`, { dueDate: before.today });
    await task(page, `Soon ${suffix}`, { dueDate: plus(2) });
    await task(page, `Also soon ${suffix}`, { dueDate: plus(2) });
    await task(page, `Later ${suffix}`, { dueDate: plus(9) });
    await task(page, `Late ${suffix}`, { dueDate: plus(-3650) });
    await page.goto('/home');
    // The overdue count is its own capsule in the week tile's head, apart from the days (HOME-B14),
    // and the strip below it is the seven days from today.
    const overdue = page.locator('.home-lead a[href="/tasks?view=overdue"]');
    await expect
      .poll(async () => latin(await overdue.textContent()))
      .toContain(latin(t('home.weekOverdue', { count: overdueBefore + 1 })));
    const cells = page.locator('.home-lead li');
    // Then seven days from today, each with what falls due on it over what was already there.
    const added = [1, 0, 2, 0, 0, 0, 0];
    for (const [index, delta] of added.entries()) {
      const cell = cells.filter({
        has: page.locator(`a[href="/tasks?view=all&due=${plus(index)}"]`),
      });
      await expect(cell).toHaveCount(1);
      const expected = t('home.due', { count: (baseline[index]?.count ?? 0) + delta });
      await expect.poll(async () => latin(await cell.textContent())).toContain(latin(expected));
      if (index === 0) await expect(cell).toHaveAttribute('aria-current', 'date');
    }
    // The ninth day is not part of the week: no cell carries it.
    expect(await page.locator(`a[href="/tasks?view=all&due=${plus(9)}"]`).count()).toBe(0);
  });
}
test('HOME-A06 HOME-B08 completing a due-today row from Home removes it and lowers the day’s count without a reload', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const { today } = await homePayload(page);
  const title = `Due today ${crypto.randomUUID()}`;
  await task(page, title, { dueDate: today });
  const dueCount = (await homePayload(page)).section('today').count;
  await page.goto('/home');
  // Kept loose while the home redesign settles: the headline speaks of the day's work, and it
  // changes when a task due today is completed, without a reload.
  const headline = page.getByRole('heading', { level: 1 });
  await expect(headline).toBeVisible();
  const said = await headline.innerText();
  expect(latin(said)).toContain(String(dueCount));
  // A reload would wipe this marker; the counts have to move without one.
  await page.evaluate(() => {
    document.documentElement.dataset.homeMarker = 'kept';
  });
  const check = page.getByRole('checkbox', {
    name: en.tasks.completeNamed.replace('{name}', title),
    exact: true,
  });
  await expect(check).toBeVisible();
  const completed = page.waitForResponse(
    (response) => response.url().includes('/complete') && response.request().method() === 'POST',
  );
  await check.click();
  expect((await completed).ok()).toBe(true);
  await expect(check).toBeHidden();
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  await expect(headline).not.toHaveText(said);
  expect(await page.evaluate(() => document.documentElement.dataset.homeMarker)).toBe('kept');
});
