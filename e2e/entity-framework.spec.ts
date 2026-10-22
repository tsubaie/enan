import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import { selectView } from './fixtures/views';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };

// EP-B23: opening a record has to make that record the subject of the page. Every part of this is
// CSS, and the part that kept failing was a cascade problem rather than a missing rule, so the
// assertions read computed style from a real browser rather than class names from a render.
async function createTask(page: Page, title: string) {
  const created = await page.evaluate(async (name) => {
    const response = await fetch('/api/v1/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'Enan',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ title: name }),
    });
    return response.json();
  }, title);
  return String(created.data.id);
}

test('EP-B23 the page hands the open record the foreground @desktop', async ({ page }) => {
  await loginAs(page, 'en');
  const prefix = `Focus ${crypto.randomUUID()}`;
  const id = await createTask(page, `${prefix} first`);
  await createTask(page, `${prefix} second`);
  await page.goto(`/tasks?view=all&q=${encodeURIComponent(prefix)}`);
  const row = page.locator(`[data-row-id="${id}"]`);
  await expect(row).toBeVisible();

  // EP-B23 (ADR 0031): the whole window behind the record is blurred and dimmed by one backdrop
  // that only paints, so the pointer resting on the list neither clears it nor is stopped by it.
  await row.click();
  await page.waitForSelector('.entity-detail');
  const backdrop = page.locator('.entity-backdrop');
  const soft = () =>
    page.evaluate(() => {
      const element = document.querySelector('.entity-backdrop');
      return element ? getComputedStyle(element).backdropFilter : 'none';
    });
  await expect(backdrop).toBeVisible();
  await expect.poll(soft).toContain('blur(');
  expect(await backdrop.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe(
    'none',
  );
  const listBox = await page.locator('[data-entity-list]:visible').boundingBox();
  await page.mouse.move((listBox?.x ?? 0) + 60, (listBox?.y ?? 0) + 120);
  await page.waitForTimeout(600);
  expect(await soft()).toContain('blur(');

  // The rest is the resting state, read once the row's own colour transition has settled.
  await page.waitForTimeout(1500);
  const planes = await page.evaluate(() => {
    const style = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };
    const active = document.activeElement as HTMLElement | null;
    return {
      listBg: style('[data-entity-list]')?.backgroundColor ?? null,
      panelBg: style('.entity-detail')?.backgroundColor ?? null,
      panelShadow: style('.entity-detail')?.boxShadow ?? null,
      currentBg: style('.entity-row[data-current]')?.backgroundColor ?? null,
      restingBg: style('.entity-row:not([data-current])')?.backgroundColor ?? null,
      focus: {
        tag: active?.tagName ?? null,
        tabIndex: active?.getAttribute('tabindex') ?? null,
        outline: active ? getComputedStyle(active).outlineStyle : null,
      },
    };
  });
  // One raised plane: the panel is its own sheet, with its own ground and shadow.
  expect(planes.listBg).not.toBe(planes.panelBg);
  expect(planes.panelShadow).not.toBe('none');
  // The selected row keeps its place with the edge bar alone: no selection tint over the glass card's
  // own ground, so it reads exactly as any other card at rest.
  expect(planes.currentBg).toBe(planes.restingBg);
  // The heading is focused so the record is announced, but it is not tabbable and draws no ring.
  expect(planes.focus).toEqual({ tag: 'H2', tabIndex: '-1', outline: 'none' });

  // Closing the record is what clears it.
  await page.keyboard.press('Escape');
  await expect(page.locator('.entity-detail')).toHaveCount(0);
  await expect(backdrop).toHaveCount(0);
});

// EP-B26: the detail is a slide-over, so the two things that separate it from the column it
// replaced are geometry (it covers the list instead of displacing it) and the fact that nothing
// behind it is inert. Both are read from a real browser for the same reason EP-B23 is.
test('EP-B26 the record slides over the list instead of displacing it @desktop', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const prefix = `Slide ${crypto.randomUUID()}`;
  const id = await createTask(page, `${prefix} first`);
  await createTask(page, `${prefix} second`);
  await page.goto(`/tasks?view=all&q=${encodeURIComponent(prefix)}`);
  const list = page.locator('[data-entity-list]:visible');
  const row = page.locator(`[data-row-id="${id}"]`);
  await expect(row).toBeVisible();

  const closed = await list.boundingBox();
  await row.click();
  const panel = page.locator('.entity-detail');
  await expect(panel).toBeVisible();
  // The entrance travels the panel's own width, so every box below has to be the resting one.
  // Polling for the edge it settles against beats sleeping for longer than the animation: the
  // measurement is the wait, and a slow frame lengthens it instead of failing it.
  const edge = () =>
    panel.boundingBox().then((box) => Math.round((box?.x ?? 0) + (box?.width ?? 0)));
  // ADR 0031: a floating sheet, inset 8 px from the window's end edge.
  await expect.poll(edge).toBe((page.viewportSize()?.width ?? 0) - 8);

  // Opening a record moves no row: the list keeps exactly the width it had when it was alone.
  const open = await list.boundingBox();
  expect(open?.width).toBeCloseTo(closed?.width ?? 0, 0);
  expect(open?.x).toBeCloseTo(closed?.x ?? 0, 0);

  // And the panel is in front of it rather than beside it, which is the same thing said in boxes:
  // a column would start where the list ends, a slide-over starts inside it.
  const over = await panel.boundingBox();
  const overlap =
    Math.min((open?.x ?? 0) + (open?.width ?? 0), (over?.x ?? 0) + (over?.width ?? 0)) -
    Math.max(open?.x ?? 0, over?.x ?? 0);
  expect(overlap).toBeGreaterThan(0);

  // The window's full height less its 8 px inset (ADR 0031): a sheet in front of the whole site,
  // not a card on the ground beside the list. It is measured against the viewport because the
  // panel is fixed, and it runs over the shell header too.
  const view = page.viewportSize();
  expect(over?.y).toBeCloseTo(8, 0);
  expect(over?.height).toBeCloseTo((view?.height ?? 0) - 16, 0);
  const header = await page.locator('header').boundingBox();
  expect((header?.x ?? 0) + (header?.width ?? 0)).toBeGreaterThan(over?.x ?? 0);

  // Not modal: no scrim was added, the list still scrolls, and it still takes Tab.
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  const second = page.locator('[data-entity-list] [data-row-id]').nth(1);
  await second.focus();
  await expect(second).toBeFocused();

  // Closing it puts nothing back, because nothing had moved.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  const after = await list.boundingBox();
  expect(after?.width).toBeCloseTo(closed?.width ?? 0, 0);
});

test('EP-B43 a click anywhere outside the record closes it like Esc @desktop', async ({ page }) => {
  await loginAs(page, 'en');
  const prefix = `Away ${crypto.randomUUID()}`;
  const id = await createTask(page, `${prefix} first`);
  await page.goto(`/tasks?view=all&q=${encodeURIComponent(prefix)}`);
  await page.locator(`[data-row-id="${id}"]`).click();
  const panel = page.locator('.entity-detail');
  await expect(panel).toBeVisible();
  // A press inside the panel leaves it open; one anywhere else on the page — here the shell
  // header — closes it without a scrim ever appearing.
  await panel.getByLabel(en.tasks.title, { exact: true }).click();
  await expect(panel).toBeVisible();
  await page.locator('header').click({ position: { x: 4, y: 4 } });
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/id=/);
});

// EP-B39: nothing in the bar may sit past the end of the screen. The settings group used to be
// `shrink-0`, so on a module carrying a period as well as a sort it measured 509 px inside a
// 390 px viewport: the sort clipped mid-word and Filter and Clear rendered off the end, where no
// pointer could reach them. Measured, not asserted on classes — the failure was a computed width.
// Both locales: an Arabic label is a different measure, and the end of the screen is the other
// edge, so LTR passing says nothing about RTL (docs/05 § Internationalization and RTL).
for (const locale of ['en', 'ar'] as const) {
  for (const width of [320, 390]) {
    test(`EP-B39 every toolbar control stays on screen at ${width} px (${locale})`, async ({
      page,
    }) => {
      const m = locale === 'ar' ? ar : en;
      await loginAs(page, locale);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/kpis?view=all');
      const toolbar = page.locator('.entity-toolbar:visible');
      await expect(toolbar).toBeVisible();
      const overflowing = await toolbar.evaluate((bar) =>
        [...bar.querySelectorAll('button, input, [role="group"]')]
          .filter((control) => {
            const box = control.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return false;
            // Past either edge: RTL overflows towards 0, LTR towards the far side.
            return box.right > window.innerWidth + 1 || box.left < -1;
          })
          .map((control) => control.textContent?.trim().slice(0, 30) ?? control.tagName),
      );
      expect(overflowing).toEqual([]);
      // The one the reader loses first when the group cannot give width back.
      await expect(
        page.getByRole('button', { name: m.common.filter, exact: true }),
      ).toBeInViewport();
    });
  }
}

// EP-B40: below 1024 px there is no featured strip. The view menu in the shell header carries the
// same views and counts, so a phone's first row under the toolbar is a record, not a summary.
for (const locale of ['en', 'ar'] as const) {
  test(`EP-B40 a phone shows no featured strip; the header's view menu carries the views (${locale})`, async ({
    page,
  }) => {
    const m = locale === 'ar' ? ar : en;
    await loginAs(page, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks?view=all');
    await expect(page.locator('.entity-toolbar:visible')).toBeVisible();
    await expect(page.locator('[data-entity-stats]:visible')).toHaveCount(0);
    await page
      .getByRole('banner')
      .getByRole('button', { name: new RegExp(`^${m.tasks.all}`, 'u') })
      .click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: new RegExp(m.tasks.inbox, 'u') }),
    ).toBeVisible();
  });
}

// Writes a unit scenario already covers go through the API, so a browser scenario spends its time
// on what the framework does with the records rather than on typing them in.
async function call(page: Page, path: string, method = 'GET', body?: object) {
  return page.evaluate(
    async (request: { path: string; method: string; body: string | null }) => {
      const response = await fetch(`/api/v1${request.path}`, {
        method: request.method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Enan',
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(request.body ? { body: request.body } : {}),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body: body ? JSON.stringify(body) : null },
  );
}
async function trash(page: Page, resource: string, id: string) {
  const current = await call(page, `/${resource}/${id}`);
  if (current.status === 200)
    await call(page, `/${resource}/${id}`, 'DELETE', { revision: current.body.data.revision });
}
const focusVisible = (page: Page) =>
  page.evaluate(() => ({
    row: document.activeElement?.getAttribute('data-row-id') ?? null,
    tag: document.activeElement?.tagName ?? null,
    label: document.activeElement?.getAttribute('aria-label') ?? null,
    visible: document.activeElement?.matches(':focus-visible') ?? false,
  }));
// Reaches the first record with the keyboard alone, through whatever the shell puts before it.
async function tabToRows(page: Page) {
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press('Tab');
    if ((await focusVisible(page)).row) return;
  }
  throw new Error('No record row was reached by Tab');
}
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const railed = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280;

// EP-A02: a link to a view and a record opens both, on a phone as on a desktop, and back returns to
// the list the reader was on. The deep link follows a visit to the list so that "back" has a list
// to return to; a fresh tab has nothing behind it.
for (const locale of ['en', 'ar'] as const) {
  test(`EP-A02 a deep link to a view and a record opens both, and back returns to the list (${locale})`, async ({
    page,
  }) => {
    const m = locale === 'ar' ? ar : en;
    await loginAs(page, locale);
    const title = `Overdue ${crypto.randomUUID()}`;
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const created = await call(page, '/tasks', 'POST', { title, dueDate: twoDaysAgo });
    const id = String(created.body.data.id);
    await page.goto('/tasks?view=overdue');
    await expect(page.locator('.entity-toolbar:visible')).toBeVisible();
    await page.goto(`/tasks?view=overdue&id=${id}`);
    // During the page transition the outgoing page can still hold its panel and its list, so only
    // the visible one is on screen (as with the toolbar above).
    const panel = page.locator('aside.entity-detail:visible');
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel(m.tasks.title, { exact: true })).toHaveValue(title);
    const list = page.locator('[data-entity-list]:visible');
    if (wide(page)) {
      // Beside the record the list is still there, and the rail says which view it is in.
      await expect(list).toBeVisible();
      if (railed(page))
        await expect(
          page
            .locator('.entity-rail:visible')
            .getByRole('button', { name: new RegExp(m.tasks.overdue, 'u') }),
        ).toHaveAttribute('aria-pressed', 'true');
    }
    // On a phone the record is a sheet over the list (EP-B38), so the list stays where it was.
    await page.goBack();
    await expect(page).toHaveURL(/view=overdue/u);
    await expect(page).not.toHaveURL(/[?&]id=/u);
    await expect(panel).toHaveCount(0);
    await expect(list).toBeVisible();
    await expect(page.locator(`[data-row-id="${id}"]`)).toBeVisible();
    // The list is the overdue view, whichever control names it at this width: the rail, or the
    // view summary in the shell header (EP-B07).
    await expect(
      page
        .locator('.entity-rail, header')
        .getByRole('button', {
          name: new RegExp(m.tasks.overdue, 'u'),
        })
        .first(),
    ).toBeVisible();
    await trash(page, 'tasks', id);
  });
}

// EP-A03: the whole loop on the keyboard alone, with focus visible at each step and never lost.
for (const locale of ['en', 'ar'] as const) {
  test(`EP-A03 keyboard-only: list, open, edit the title, save, close, with visible focus throughout (${locale})`, async ({
    page,
  }) => {
    const m = locale === 'ar' ? ar : en;
    await loginAs(page, locale);
    const prefix = `Keys ${crypto.randomUUID()}`;
    const first = await call(page, '/tasks', 'POST', { title: `${prefix} first` });
    const second = await call(page, '/tasks', 'POST', { title: `${prefix} second` });
    const ids = [String(first.body.data.id), String(second.body.data.id)];
    await page.goto(`/tasks?view=all&q=${encodeURIComponent(prefix)}`);
    await expect(page.locator('[data-row-id]')).toHaveCount(2);
    // The arrows follow the list's own order, whichever way the view sorts the two records.
    const order = await page
      .locator('[data-row-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-row-id') ?? ''));
    expect([...order].sort()).toEqual([...ids].sort());

    // List: Tab reaches a row and the arrows walk the rows, each with a visible ring.
    await tabToRows(page);
    let focus = await focusVisible(page);
    expect(order).toContain(focus.row);
    expect(focus.visible).toBe(true);
    const start = order.indexOf(focus.row ?? '');
    await page.keyboard.press(start === 0 ? 'ArrowDown' : 'ArrowUp');
    focus = await focusVisible(page);
    expect(focus.row).toBe(order[start === 0 ? 1 : 0]);
    expect(focus.visible).toBe(true);
    await page.keyboard.press(start === 0 ? 'ArrowUp' : 'ArrowDown');
    focus = await focusVisible(page);
    expect(focus.row).toBe(order[start]);
    const opened = order[start] ?? '';

    // Open: Enter opens the record and focus lands on its heading (EP-B17).
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`id=${opened}`, 'u'));
    await expect.poll(async () => (await focusVisible(page)).tag).toBe('H2');

    // Edit: Tab into the title field, which is the heading itself, and retype it.
    await page.keyboard.press('Tab');
    focus = await focusVisible(page);
    expect(focus.label).toBe(m.tasks.title);
    expect(focus.visible).toBe(true);
    const renamed = `${prefix} renamed`;
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(renamed);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/tasks/${opened}`) &&
        response.request().method() === 'PATCH',
    );
    // Save: Enter commits the field; the pill in the bar acknowledges it.
    await page.keyboard.press('Enter');
    expect((await saved).ok()).toBe(true);
    await expect(page.getByRole('status')).toContainText(m.common.saved);
    expect((await call(page, `/tasks/${opened}`)).body.data.title).toBe(renamed);
    // The field is left but focus is not: it rests inside the panel, ready for Escape.
    focus = await focusVisible(page);
    expect(focus.tag).not.toBe('BODY');

    // Close: Escape closes the record and focus returns to the row it came from (EP-B17).
    await page.keyboard.press('Escape');
    await expect(page.locator('aside.entity-detail')).toHaveCount(0);
    await expect.poll(async () => (await focusVisible(page)).row).toBe(opened);
    expect((await focusVisible(page)).visible).toBe(true);
    for (const id of ids) await trash(page, 'tasks', id);
  });
}

// EP-A04: a 409 keeps the draft on screen and offers to reload and reapply it; the requests the
// panel makes never run out of order, each carrying a revision no older than the last answer.
test('EP-A04 a conflicting save keeps the draft and reapplies it on the reloaded revision', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const title = `Conflict ${crypto.randomUUID()}`;
  const created = await call(page, '/tasks', 'POST', { title });
  const id = String(created.body.data.id);
  const revisions: number[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith(`/api/v1/tasks/${id}`))
      revisions.push(Number(JSON.parse(request.postData() ?? '{}').revision));
  });
  // The first save is refused as a conflict before it reaches the server; every later one goes
  // through. The envelope is the API's own shape, so the client reads it as it would a real one.
  let refused = false;
  await page.route(`**/api/v1/tasks/${id}`, async (route) => {
    if (route.request().method() !== 'PATCH' || refused) return route.continue();
    refused = true;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'conflict',
          message: 'Someone else changed this record.',
          details: {},
          requestId: 'req-forced-409',
        },
      }),
    });
  });
  await page.goto(`/tasks?view=all&id=${id}`);
  const panel = page.locator('aside.entity-detail');
  const field = panel.getByLabel(en.tasks.title, { exact: true });
  await expect(field).toHaveValue(title);
  const draft = `${title} edited`;
  await field.fill(draft);
  await page.keyboard.press('Enter');
  // The conflict is reported where the record is, the draft stays in the field, and the way
  // forward is offered: reload the latest revision and reapply what was typed.
  await expect(panel.getByText(en.common.conflictReapply)).toBeVisible();
  await expect(panel.getByRole('alert').first()).toContainText('req-forced-409');
  const reapply = panel.getByRole('button', { name: en.common.reapply, exact: true });
  await expect(reapply).toBeVisible();
  await expect(field).toHaveValue(draft);
  await expect(page.getByRole('status')).toContainText(en.common.saveFailed);
  expect((await call(page, `/tasks/${id}`)).body.data.title).toBe(title);
  const applied = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/tasks/${id}`) && response.request().method() === 'PATCH',
  );
  await reapply.click();
  expect((await applied).ok()).toBe(true);
  await expect(page.getByRole('status')).toContainText(en.common.saved);
  await expect(panel.getByRole('button', { name: en.common.reapply, exact: true })).toHaveCount(0);
  const after = await call(page, `/tasks/${id}`);
  expect(after.body.data.title).toBe(draft);
  // Two requests, in order, neither carrying a revision older than the one before it.
  expect(revisions).toHaveLength(2);
  expect(revisions[1]).toBeGreaterThanOrEqual(revisions[0] ?? 0);
  expect(after.body.data.revision).toBeGreaterThan(revisions[1] ?? 0);
  await trash(page, 'tasks', id);
});

// EP-A05: selecting with `x` exposes exactly the note-safe actions and each of them acts on every
// selected note — nothing grouping, threading or merging is offered.
for (const locale of ['en', 'ar'] as const) {
  test(`EP-A05 three notes selected with x offer Archive and Add tag only, and each acts on all three (${locale})`, async ({
    page,
  }) => {
    const m = locale === 'ar' ? ar : en;
    await loginAs(page, locale);
    const prefix = `Pick ${crypto.randomUUID()}`;
    const ids: string[] = [];
    for (const suffix of ['one', 'two', 'three'])
      ids.push(
        String((await call(page, '/notes', 'POST', { title: `${prefix} ${suffix}` })).body.data.id),
      );
    await page.goto(`/notes?view=all&q=${encodeURIComponent(prefix)}`);
    const rows = page.locator('[data-row-id]');
    await expect(rows).toHaveCount(3);
    const selectAllThree = async () => {
      await rows.first().focus();
      await page.keyboard.press('x');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('x');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('x');
      await expect(page).toHaveURL(/sel=[^&,]+(?:,|%2C)[^&,]+(?:,|%2C)[^&,]+/u);
    };
    await selectAllThree();
    const bar = page.locator('[data-entity-bulk]');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button')).toHaveText([m.notes.archive, m.notes.addTag]);

    await bar.getByRole('button', { name: m.notes.archive, exact: true }).click();
    await page.getByRole('button', { name: m.common.confirm, exact: true }).click();
    for (const id of ids)
      await expect
        .poll(async () => (await call(page, `/notes/${id}`)).body.data.archivedAt)
        .not.toBeNull();
    // Running an action clears the selection; the bar goes with it.
    await expect(bar).toHaveCount(0);
    await expect(page).not.toHaveURL(/sel=/u);

    await selectAllThree();
    await bar.getByRole('button', { name: m.notes.addTag, exact: true }).click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    const tag = `tag${crypto.randomUUID().slice(0, 6)}`;
    await dialog.getByLabel(m.notes.tagName, { exact: true }).fill(tag);
    await dialog.getByRole('button', { name: m.notes.addTag, exact: true }).click();
    await expect(dialog).toBeHidden();
    for (const id of ids)
      await expect
        .poll(async () => (await call(page, `/notes/${id}`)).body.data.tags)
        .toEqual([tag]);
    for (const id of ids) await trash(page, 'notes', id);
  });
}

// EP-A06: in Arabic the end edge is the left, so the record is a slide-over on the left of the
// window and on a phone it arrives from the left; the arrows still walk the list in list order.
test('EP-A06 RTL: the record sits on the left, enters from the left, and arrows follow list order', async ({
  page,
}) => {
  await loginAs(page, 'ar');
  const prefix = `اتجاه ${crypto.randomUUID()}`;
  const first = await call(page, '/tasks', 'POST', { title: `${prefix} أول` });
  const second = await call(page, '/tasks', 'POST', { title: `${prefix} ثانٍ` });
  const ids = [String(first.body.data.id), String(second.body.data.id)];
  await page.goto(`/tasks?view=all&q=${encodeURIComponent(prefix)}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const rows = page.locator('[data-row-id]');
  await expect(rows).toHaveCount(2);
  // List order, not visual direction: down is the row below whichever side the text sits on.
  const top = await rows.first().getAttribute('data-row-id');
  const bottom = await rows.nth(1).getAttribute('data-row-id');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  expect((await focusVisible(page)).row).toBe(bottom);
  await page.keyboard.press('ArrowUp');
  expect((await focusVisible(page)).row).toBe(top);

  await page.keyboard.press('Enter');
  const panel = page.locator('aside.entity-detail');
  await expect(panel).toBeVisible();
  const slide = await panel.evaluate((element) =>
    getComputedStyle(element).getPropertyValue('--panel-slide').trim(),
  );
  if (wide(page)) {
    // The slide-over sits 8 px in from the window's left edge, and it travelled in from beyond it.
    await expect.poll(() => panel.boundingBox().then((box) => Math.round(box?.x ?? -1))).toBe(8);
    const list = await page.locator('[data-entity-list]:visible').boundingBox();
    const over = await panel.boundingBox();
    expect((over?.x ?? 0) + (over?.width ?? 0)).toBeLessThan((list?.x ?? 0) + (list?.width ?? 0));
    expect(slide).toBe('-100%');
  } else {
    // The full-screen view steps in from the left: the mirror of the LTR nudge.
    expect(slide).toBe('-1rem');
    await expect(panel).toBeVisible();
  }
  for (const id of ids) await trash(page, 'tasks', id);
});

// EP-B30: the surface is read and re-read without being reloaded. Opening a record writes the
// address without asking the server for the page, and a list whose question changes keeps the
// rows it has until the answer arrives rather than emptying to the placeholder.
test('EP-B30 opening a record requests no page, and a changed list query keeps its rows while loading', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const prefix = `Reread ${crypto.randomUUID()}`;
  const first = await call(page, '/tasks', 'POST', { title: `${prefix} first` });
  const second = await call(page, '/tasks', 'POST', { title: `${prefix} second` });
  const ids = [String(first.body.data.id), String(second.body.data.id)];
  await page.goto(`/tasks?view=inbox&q=${encodeURIComponent(prefix)}`);
  const rows = page.locator('[data-entity-list] [data-row-id]');
  await expect(rows).toHaveCount(2);
  const pageRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    // The router prefetches the rail's links on its own schedule (Next-Router-Prefetch); only
    // a request for the page itself is what this scenario forbids.
    if (url.pathname === '/tasks' && !request.headers()['next-router-prefetch'])
      pageRequests.push(`${request.resourceType()} ${url.search}`);
  });
  await page.locator(`[data-row-id="${ids[0]}"]`).click();
  await expect(page.locator('aside.entity-detail')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`id=${ids[0]}`, 'u'));
  await page.keyboard.press('Escape');
  await expect(page.locator('aside.entity-detail')).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]id=/u);
  // The record came and went through history alone; nothing asked the server for /tasks.
  expect(pageRequests).toEqual([]);

  // Hold the next list query so the moment between questions can be looked at.
  const gate: { release: () => void } = { release: () => undefined };
  const held = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  let holding = false;
  await page.route('**/api/v1/tasks?*', async (route) => {
    const url = new URL(route.request().url());
    if (holding || url.searchParams.get('view') !== 'all' || url.searchParams.get('q') !== prefix)
      return route.continue();
    holding = true;
    await held;
    return route.continue();
  });
  await selectView(page, 'en', new RegExp(`^${en.tasks.all}`, 'u'));
  await expect(page).toHaveURL(/view=all/u);
  await expect.poll(() => holding).toBe(true);
  // The old rows stand while the new answer is out; no placeholder replaces them.
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-entity-list] [role="status"]')).toHaveCount(0);
  gate.release();
  await expect(rows).toHaveCount(2);
  for (const id of ids) await trash(page, 'tasks', id);
});

// EP-B32: the title group sits in the shell header at every width (EP-B07), so the list bar is a
// row of controls with no heading of its own. On a phone that row holds search and Create side by
// side, with Create at the end edge. The test reads geometry rather than classes, both directions.
for (const locale of ['en', 'ar'] as const) {
  test(`EP-B32 the bar is one row of controls and the title is in the header (${locale})`, async ({
    page,
  }) => {
    const m = locale === 'ar' ? ar : en;
    await loginAs(page, locale);
    await page.goto('/tasks?view=all');
    // `:visible` throughout: while React streams the page in, the finished segment waits in a
    // hidden `<div id="S:…">` beside what is on screen, so for a moment there are two bars.
    const toolbar = page.locator('.entity-toolbar:visible');
    await expect(toolbar).toBeVisible();
    await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(toolbar.getByRole('heading', { level: 1 })).toHaveCount(0);
    const search = toolbar.getByRole('textbox', { name: m.tasks.searchList, exact: true });
    const searchBox = await search.boundingBox();
    const barBox = await toolbar.boundingBox();
    if (!searchBox || !barBox) throw new Error('The bar did not lay out');
    if (wide(page)) {
      expect(barBox.height).toBeLessThanOrEqual(80);
      return;
    }
    // One row: Create shares search's line and holds the end edge of the phone.
    const create = await toolbar
      .getByRole('button', { name: m.common.create, exact: true })
      .boundingBox();
    if (!create) throw new Error('Create is not in the bar');
    expect(
      Math.abs(create.y + create.height / 2 - (searchBox.y + searchBox.height / 2)),
    ).toBeLessThan(4);
    const rtl = locale === 'ar';
    const gap = rtl ? create.x - barBox.x : barBox.x + barBox.width - (create.x + create.width);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(24);
  });
}

// EP-B34: with a record open the bar keeps clear of the panel, and what it drops is gone from the
// document rather than drawn under the slide-over for Tab to find.
test('EP-B34 the bar keeps clear of the open record and drops the list-wide settings @desktop', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const prefix = `Clear ${crypto.randomUUID()}`;
  const id = await createTask(page, `${prefix} first`);
  await page.goto(`/tasks?view=all&q=${encodeURIComponent(prefix)}`);
  const toolbar = page.locator('.entity-toolbar:visible');
  await expect(toolbar.getByLabel(en.common.sort)).toHaveCount(1);
  await expect(toolbar.getByRole('button', { name: en.common.select, exact: true })).toHaveCount(1);
  await page.locator(`[data-row-id="${id}"]`).click();
  const panel = page.locator('aside.entity-detail');
  await expect(panel).toBeVisible();
  await expect
    .poll(() => panel.boundingBox().then((box) => Math.round((box?.x ?? 0) + (box?.width ?? 0))))
    .toBe((page.viewportSize()?.width ?? 0) - 8);
  const over = await panel.boundingBox();
  // Nothing focusable in the bar lies under the panel.
  const covered = await toolbar.evaluate(
    (bar, edge) =>
      [...bar.querySelectorAll('button, input, [role="combobox"]')]
        .filter((control) => {
          const box = control.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.right > edge + 1;
        })
        .map((control) => control.getAttribute('aria-label') ?? control.textContent?.trim() ?? ''),
    over?.x ?? 0,
  );
  expect(covered).toEqual([]);
  // What fits stays; the list-wide settings are absent, not hidden.
  await expect(
    toolbar.getByRole('textbox', { name: en.tasks.searchList, exact: true }),
  ).toBeVisible();
  await expect(toolbar.getByRole('button', { name: en.common.filter, exact: true })).toBeVisible();
  await expect(toolbar.getByLabel(en.common.sort)).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: en.common.select, exact: true })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: en.common.clear, exact: true })).toHaveCount(0);
  // They come back when the record closes.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(toolbar.getByLabel(en.common.sort)).toHaveCount(1);
  await expect(toolbar.getByRole('button', { name: en.common.select, exact: true })).toHaveCount(1);
  await trash(page, 'tasks', id);
});

// EP-B35: the list says a thing once. The rail carries every view with its count; the strip and
// the toolbar's summary are its stand-ins and appear exactly where the rail does not.
test('EP-B35 the strip and the view summary appear only where the rail is not showing the same facts', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await page.goto('/tasks?view=all');
  const toolbar = page.locator('.entity-toolbar:visible');
  await expect(toolbar).toBeVisible();
  const rail = page.locator('.entity-rail:visible');
  const strip = page.locator('[data-entity-stats]:visible');
  // The summary sits in the shell header at every width (EP-B07).
  const summary = page.getByRole('banner').getByRole('button', {
    name: new RegExp(`^${en.tasks.all}`, 'u'),
  });
  if (railed(page)) {
    // Every view in the rail carries its count, and nothing repeats them below the bar.
    await expect(rail).toBeVisible();
    const labels = await rail.locator('[aria-pressed]').allTextContents();
    expect(labels.length).toBeGreaterThan(1);
    for (const label of labels) expect(label).toMatch(/\d/u);
    await expect(strip).toBeHidden();
    await expect(summary).toBeHidden();
    // Collapsing the rail is what brings the stand-ins in; the summary is a control into the views.
    await page.getByRole('button', { name: en.common.collapseViews, exact: true }).click();
    await expect(rail).toBeHidden();
    await expect(strip).toBeVisible();
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: en.common.expandViews, exact: true }).click();
    await expect(rail).toBeVisible();
    await expect(strip).toBeHidden();
    await expect(summary).toBeHidden();
  } else {
    // No rail at this width, so the summary is simply there; the strip is too from 1024 px, while
    // a phone leaves the views to the summary alone (EP-B40).
    await expect(rail).toBeHidden();
    if (wide(page)) await expect(strip).toBeVisible();
    else await expect(strip).toBeHidden();
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(page.locator('[data-slot="dialog-content"]')).toBeVisible();
  }
});
