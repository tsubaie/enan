import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
// The catalogs hold ICU messages; the scenarios need the rendered string.
const fill = (message: string, values: Record<string, string>) =>
  message.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? '');
async function createTask(page: Page, title: string) {
  return page.evaluate(async (title) => {
    const response = await fetch('/api/v1/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'Enan',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ title }),
    });
    const body = await response.json();
    return { id: String(body.data.id), revision: Number(body.data.revision) };
  }, title);
}
async function trashTask(page: Page, task: { id: string; revision: number }) {
  await page.evaluate(async (task) => {
    await fetch(`/api/v1/tasks/${task.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'Enan',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ revision: task.revision }),
    });
  }, task);
}
async function createNote(page: Page, title: string, content: string) {
  return page.evaluate(
    async ({ title, content }) => {
      const response = await fetch('/api/v1/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Enan',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ title, content }),
      });
      const body = await response.json();
      return { id: String(body.data.id), revision: Number(body.data.revision) };
    },
    { title, content },
  );
}
async function trashNote(page: Page, note: { id: string; revision: number }) {
  await page.evaluate(async (note) => {
    await fetch(`/api/v1/notes/${note.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'Enan',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ revision: note.revision }),
    });
  }, note);
}
// A phrase no earlier run can have left behind, so the palette's per-module cap of five never
// hides the records a scenario just made.
const phrase = () => `zq${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
for (const locale of ['en', 'ar'] as const) {
  const m = locale === 'ar' ? ar : en;
  // SEARCH-B11: the header carries a launcher, not a field. On a desktop it says the word beside
  // the icon; on a phone the icon alone. Either form and the chord open the same palette.
  test(`SEARCH-B11 the header search is a launcher with a word on a desktop and an icon on a phone (${locale})`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    await page.goto('/home');
    const launcher = page.getByRole('button', { name: m.common.searchWorkspace, exact: true });
    const palette = page.getByRole('dialog');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByText(m.common.searchOpen, { exact: true })).toBeVisible();
    // A launcher, not a field: nothing in the header is a text box until the palette opens.
    await expect(page.locator('header').getByRole('textbox')).toHaveCount(0);
    await launcher.click();
    await expect(palette.getByRole('searchbox', { name: m.common.search })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByText(m.common.searchOpen, { exact: true })).toBeHidden();
    const box = await launcher.boundingBox();
    if (!box) throw new Error('Missing launcher geometry');
    expect(box.width).toBeLessThan(48);
    await page.keyboard.press('Control+k');
    await expect(palette.getByRole('searchbox', { name: m.common.search })).toBeVisible();
  });
  // SEARCH-B12: opened over a list, the palette's first row hands the phrase to that list.
  test(`SEARCH-B12 the palette opened over a list hands the phrase to that list (${locale})`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const title = `Hand-off ${crypto.randomUUID()}`;
    await page.goto('/tasks?view=all');
    const task = await createTask(page, title);
    try {
      await page.goto('/home');
      await page.keyboard.press('Control+k');
      const palette = page.getByRole('dialog');
      await palette.getByRole('searchbox', { name: m.common.search }).fill(title);
      // No list on the home page, so no hand-off row.
      await expect(
        palette.getByRole('button', {
          name: fill(m.common.searchScope, { module: m.common.tasks, query: title }),
        }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.goto('/tasks?view=all');
      await page.keyboard.press('Control+k');
      await palette.getByRole('searchbox', { name: m.common.search }).fill(title);
      await palette
        .getByRole('button', {
          name: fill(m.common.searchScope, { module: m.common.tasks, query: title }),
        })
        .click();
      await expect(palette).toBeHidden();
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(title);
      await expect(
        page.getByRole('textbox', { name: m.tasks.searchList, exact: true }),
      ).toHaveValue(title);
      await expect(page.locator('[data-row-id]')).toHaveCount(1);
      await page.goBack();
      await expect(page).not.toHaveURL(/[?&]q=/);
    } finally {
      await trashTask(page, task);
    }
  });
  // SEARCH-A01: one question asked of every module. A phrase that lives in a note's body and in
  // a task's title surfaces both, each under its own module heading, and Enter on the note lands
  // on the notes route with the record open (SEARCH-B07).
  test(`SEARCH-A01 SEARCH-B07 the chord, a phrase in a note body and a task title, both under their module headings; Enter opens the note (${locale})`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const token = phrase();
    const task = await createTask(page, `Task ${token}`);
    const note = await createNote(page, `Note ${crypto.randomUUID()}`, `Body mentions ${token}.`);
    try {
      await page.goto('/home');
      await page.keyboard.press('Control+k');
      const palette = page.getByRole('dialog');
      await palette.getByRole('searchbox', { name: m.common.search }).fill(token);
      const tasks = palette.getByRole('heading', { name: m.common.tasks, exact: true });
      const notes = palette.getByRole('heading', { name: m.common.notes, exact: true });
      await expect(tasks).toBeVisible();
      await expect(notes).toBeVisible();
      const taskHit = palette.getByRole('button', { name: `Task ${token}` });
      await expect(taskHit).toBeVisible();
      // The task hit sits in the tasks group and the note hit in the notes group.
      expect(await tasks.locator('..').getByRole('button').count()).toBe(1);
      const noteHit = notes.locator('..').getByRole('button');
      await expect(noteHit).toHaveCount(1);
      await noteHit.focus();
      await page.keyboard.press('Enter');
      await expect(palette).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/notes\\?(?:.*&)?id=${note.id}`));
      await expect(page.locator('aside.entity-detail')).toBeVisible();
    } finally {
      await trashTask(page, task);
      await trashNote(page, note);
    }
  });
  // SEARCH-A04: trash is not a hiding place the palette can see into.
  test(`SEARCH-A04 SEARCH-B05 a trashed task is not reachable from the palette (${locale})`, async ({
    page,
  }) => {
    await loginAs(page, locale);
    const token = phrase();
    const task = await createTask(page, `Trashed ${token}`);
    await page.goto('/home');
    const launcher = page.getByRole('button', { name: m.common.searchWorkspace, exact: true });
    const palette = page.getByRole('dialog');
    const field = palette.getByRole('searchbox', { name: m.common.search });
    await launcher.click();
    await field.fill(token);
    await expect(palette.getByRole('button', { name: `Trashed ${token}` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await trashTask(page, task);
    // A fresh document: the palette keeps an answer for thirty seconds, and the question here is
    // what the server says about a trashed record, not what the cache remembers.
    await page.goto('/home');
    await launcher.click();
    await field.fill(token);
    await expect(palette.getByText(m.common.searchEmpty, { exact: true })).toBeVisible();
    await expect(palette.getByRole('button', { name: `Trashed ${token}` })).toHaveCount(0);
  });
}
// SEARCH-A02: the corpus and the query are normalised the same way, so a reader who does not
// type the diacritics still finds the record that was written with them.
test('SEARCH-A02 SEARCH-B01 an Arabic query without diacritics finds the record written with them (ar)', async ({
  page,
}) => {
  await loginAs(page, 'ar');
  const token = phrase();
  const task = await createTask(page, `مُراجَعَة الميزانيّة ${token}`);
  try {
    await page.goto('/home');
    await page.getByRole('button', { name: ar.common.searchWorkspace, exact: true }).click();
    const palette = page.getByRole('dialog');
    await palette
      .getByRole('searchbox', { name: ar.common.search })
      .fill(`مراجعة الميزانية ${token}`);
    const hit = palette.getByRole('button', { name: `مُراجَعَة الميزانيّة ${token}` });
    await expect(hit).toBeVisible();
    await expect(
      palette.getByRole('heading', { name: ar.common.tasks, exact: true }),
    ).toBeVisible();
  } finally {
    await trashTask(page, task);
  }
});
// SEARCH-B08: a way to get somewhere, not a place. Either opener leaves the URL alone, Esc closes
// and Enter on a hit opens it.
test('SEARCH-B08 the chord and the header control open the palette without touching the URL; Esc closes it and Enter opens a hit', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const token = phrase();
  const task = await createTask(page, `Opened ${token}`);
  try {
    await page.goto('/tasks?view=all');
    const before = page.url();
    const palette = page.getByRole('dialog');
    await page.keyboard.press('Control+k');
    await expect(palette.getByRole('searchbox', { name: en.common.search })).toBeVisible();
    expect(page.url()).toBe(before);
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    expect(page.url()).toBe(before);
    await page.getByRole('button', { name: en.common.searchWorkspace, exact: true }).click();
    const field = palette.getByRole('searchbox', { name: en.common.search });
    await expect(field).toBeVisible();
    expect(page.url()).toBe(before);
    await field.fill(token);
    const hit = palette.getByRole('button', { name: `Opened ${token}` });
    await expect(hit).toBeVisible();
    await hit.focus();
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?(?:.*&)?id=${task.id}`));
    await expect(page.getByRole('heading', { name: `Opened ${token}`, exact: true })).toBeVisible();
  } finally {
    await trashTask(page, task);
  }
});
