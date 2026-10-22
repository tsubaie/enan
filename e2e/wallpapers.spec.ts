import type { Browser, Page } from '@playwright/test';
import sharp from 'sharp';
import { z } from 'zod';
import { test, expect } from './fixtures/test';
import { laneBaseURL } from './lanes';
import { loginAs } from './fixtures/auth';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
// ADMIN-B42, ADMIN-B47 (ADR 0037): the workspace wallpaper, built in or uploaded, and the accent it
// sets. The wallpaper is shared by every page of the lane, so each scenario puts the setting back
// and deletes what it uploaded.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
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
      return { status: response.status, body: (await response.json()) as Json };
    },
    { path, method, body },
  );
}
const Settings = z.object({ data: z.array(z.object({ key: z.string(), value: z.json() })) });
async function wallpaper(page: Page) {
  const listed = Settings.parse((await api(page, '/admin/settings')).body);
  return listed.data.find((row) => row.key === 'workspace.wallpaper')?.value;
}
const Uploaded = z.object({ data: z.array(z.object({ id: z.string(), name: z.string() })) });
const uploaded = async (page: Page) =>
  Uploaded.parse((await api(page, '/admin/wallpapers')).body).data;
const accent = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );
const html = (page: Page) => page.locator('html');
const builtIns = (page: Page) => page.getByRole('radiogroup', { name: en.admin.wallpaper });
const yours = (page: Page) => page.getByRole('radiogroup', { name: en.admin.wallpaperYours });
// A still JPEG of one strong colour, `width` × `height`, made in memory and handed to the file
// chooser as it is, so the scenario never touches the disk.
type Picked = { name: string; mimeType: string; buffer: Buffer };
async function image(name: string, width: number, height: number): Promise<Picked> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 96, b: 24 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { name: `${name}.jpg`, mimeType: 'image/jpeg', buffer };
}
async function upload(page: Page, file: Picked) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: en.admin.wallpaperUpload, exact: true }).click();
  await (await chooser).setFiles(file);
}

test('ADMIN-B42 the built-ins are jade by default, sky and neon each set the accent, and none can be deleted', async ({
  page,
}) => {
  await loginAs(page, 'en');
  const before = await wallpaper(page);
  try {
    // A fresh workspace (the lane's, set up by the suite) starts on Jade.
    expect(
      (await api(page, '/admin/settings', 'PATCH', { key: 'workspace.wallpaper', value: 'jade' }))
        .status,
    ).toBe(200);
    await page.goto('/admin/settings');
    await expect(html(page)).toHaveAttribute('data-wallpaper', 'jade');
    const radios = builtIns(page).getByRole('radio');
    await expect(radios).toHaveText([
      en.admin.wallpaper_ribbon,
      en.admin.wallpaper_copper,
      en.admin.wallpaper_jade,
      en.admin.wallpaper_neon,
      en.admin.wallpaper_folds,
      en.admin.wallpaper_stone,
      en.admin.wallpaper_arc,
      en.admin.wallpaper_sky,
    ]);
    // The retired wallpapers are gone from the picker and refused by the registry.
    for (const retired of ['indigo', 'fan', 'mist']) {
      const refused = await api(page, '/admin/settings', 'PATCH', {
        key: 'workspace.wallpaper',
        value: retired,
      });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
    }
    await expect(
      builtIns(page).getByRole('radio', { name: en.admin.wallpaper_jade }),
    ).toHaveAttribute('aria-checked', 'true');
    // Built-ins carry no delete button.
    await expect(builtIns(page).getByRole('button', { name: /^Delete /u })).toHaveCount(0);
    const jade = await accent(page);
    await builtIns(page).getByRole('radio', { name: en.admin.wallpaper_sky }).click();
    await expect(html(page)).toHaveAttribute('data-wallpaper', 'sky');
    await expect.poll(() => accent(page)).not.toBe(jade);
    const sky = await accent(page);
    await builtIns(page).getByRole('radio', { name: en.admin.wallpaper_neon }).click();
    await expect(html(page)).toHaveAttribute('data-wallpaper', 'neon');
    await expect.poll(() => accent(page)).not.toBe(sky);
    expect(await wallpaper(page)).toBe('neon');
    // It holds across a reload: every page reads it while rendering.
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-wallpaper', 'neon');
  } finally {
    await api(page, '/admin/settings', 'PATCH', { key: 'workspace.wallpaper', value: before });
  }
});

async function member(page: Page, browser: Browser) {
  const email = `member-${crypto.randomUUID()}@example.test`;
  const created = await api(page, '/admin/users', 'POST', {
    name: 'Wallpaper Member',
    email,
    role: 'member',
  });
  expect(created.status).toBe(201);
  const password = z
    .object({ meta: z.object({ temporaryPassword: z.string() }) })
    .parse(created.body).meta.temporaryPassword;
  const context = await browser.newContext({ baseURL: laneBaseURL() });
  const other = await context.newPage();
  await context.addCookies([{ name: 'eos_locale', value: 'en', url: laneBaseURL() }]);
  await other.goto('/login');
  await other.getByLabel(en.auth.email).fill(email);
  await other.getByLabel(en.auth.password).fill(password);
  await other.getByRole('button', { name: en.auth.login, exact: true }).click();
  await expect(other).toHaveURL(/home/u);
  return context;
}

test('ADMIN-B47 an uploaded image becomes the wallpaper and its accent, a small one is refused, a member is refused, and deleting the chosen one returns to jade', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await loginAs(page, 'en');
  const before = await wallpaper(page);
  const name = `Sunset ${crypto.randomUUID().slice(0, 8)}`;
  const large = await image(name, 1600, 1000);
  const small = await image('small', 800, 500);
  try {
    await api(page, '/admin/settings', 'PATCH', { key: 'workspace.wallpaper', value: 'jade' });
    await page.goto('/admin/settings');
    await expect(html(page)).toHaveAttribute('data-wallpaper', 'jade');
    const jade = await accent(page);

    // Too small: refused in words under the tile, and nothing stored.
    const refused = page.waitForResponse(
      (reply) =>
        reply.url().endsWith('/api/v1/admin/wallpapers') && reply.request().method() === 'POST',
    );
    await upload(page, small);
    const reply = await refused;
    expect(reply.status()).toBe(422);
    expect(JSON.stringify(await reply.json())).toContain('too_small');
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: en.admin.wallpaperTooSmall.replace('{size}', '1280') }),
    ).toBeVisible();
    expect((await uploaded(page)).some((row) => row.name === 'small')).toBe(false);

    // A large enough image is listed under its file name and can be chosen.
    await upload(page, large);
    const tile = yours(page).getByRole('radio', { name, exact: true });
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(html(page)).toHaveAttribute('data-wallpaper', 'custom');
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => accent(page)).not.toBe(jade);
    const id = (await uploaded(page)).find((row) => row.name === name)?.id;
    expect(id).toBeDefined();
    expect(await wallpaper(page)).toBe(id);
    expect(
      await html(page).evaluate((element) => element.style.getPropertyValue('--wallpaper-image')),
    ).toContain(id!);
    // The image is served to a signed-in reader as WebP, never as the uploaded bytes.
    const served = await page.request.get(`/api/v1/wallpapers/${id}`);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/webp');

    // A member may neither list nor upload.
    const context = await member(page, browser);
    try {
      const other = context.request;
      expect(
        (
          await other.get('/api/v1/admin/wallpapers', {
            headers: { 'X-Requested-With': 'Enan' },
          })
        ).status(),
      ).toBe(403);
      const attempt = await other.post('/api/v1/admin/wallpapers', {
        headers: {
          'X-Requested-With': 'Enan',
          Origin: laneBaseURL(),
          'Idempotency-Key': crypto.randomUUID(),
        },
        multipart: {
          file: { ...large, name: 'member.jpg' },
        },
      });
      expect(attempt.status()).toBe(403);
    } finally {
      await context.close();
    }

    // Delete asks first, says the default takes its place, and Keep changes nothing.
    const remove = yours(page).getByRole('button', {
      name: en.admin.wallpaperDelete.replace('{name}', name),
      exact: true,
    });
    await remove.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(en.admin.wallpaperDeleteChosen, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: en.admin.wallpaperKeep, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await wallpaper(page)).toBe(id);
    await remove.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: en.admin.wallpaperDeleteAction, exact: true })
      .click();
    await expect(tile).toHaveCount(0);
    await expect.poll(() => wallpaper(page)).toBe('jade');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-wallpaper', 'jade');
    expect((await uploaded(page)).some((row) => row.id === id)).toBe(false);
    expect((await page.request.get(`/api/v1/wallpapers/${id}`)).status()).toBe(404);
  } finally {
    for (const row of await uploaded(page))
      if (row.name === name || row.name === 'small')
        await api(page, `/admin/wallpapers/${row.id}`, 'DELETE');
    await api(page, '/admin/settings', 'PATCH', { key: 'workspace.wallpaper', value: before });
  }
});
