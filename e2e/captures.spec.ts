import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import { fill } from './fixtures/messages';
import { laneBaseURL } from './lanes';
import { seedDrafts } from './fixtures/captures';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
// CAPTURES-A01–A04, A06–A11 (A05 is NOTES-A15). AI is off in the browser suite, so a recording is
// stored without a transcript; `scripts/db/e2e-capture-drafts.ts` stands in for the interpreter
// where a scenario needs drafts. The microphone is refused in the page, so the recorder offers
// its upload fallback (S3) and the scenarios send a real WAV through it.
async function api(page: Page, path: string, method = 'GET', body?: object) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Enan',
          'Idempotency-Key': crypto.randomUUID(),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
    { path, method, body },
  );
}
// A second of 8 kHz mono 8-bit silence with bytes of its own, so its stored hash is new.
function wav() {
  const samples = 8000;
  const buffer = Buffer.alloc(44 + samples, 0x80);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(samples, 24);
  buffer.writeUInt32LE(samples, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples, 40);
  buffer.writeUInt32LE(Math.floor(Math.random() * 2 ** 32), buffer.length - 4);
  return buffer;
}
// The microphone is refused, as a browser without permission would; the recorder then offers S3.
async function refuseMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      },
    });
  });
}
// S1/S9 → S2 → S3 → S11: start from wherever the page is, upload instead, and dismiss Done.
async function recordByUpload(page: Page, m: typeof en) {
  await page
    .getByRole('button', { name: m.captures.recordNote })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole('button', { name: m.captures.continue }).click();
  await expect(page.getByText(m.captures.refusedTitle)).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/captures' && response.status() === 201,
  );
  await page
    .getByTestId('capture-file')
    .setInputFiles({ name: 'hallway.wav', mimeType: 'audio/wav', buffer: wav() });
  const captureId: string = (await (await created).json()).data.id;
  await page.getByRole('button', { name: m.captures.done }).first().click();
  return captureId;
}
async function openReview(page: Page, m: typeof en) {
  await page
    .getByRole('link', {
      name: new RegExp(`^(${m.captures.review}|${m.captures.reviewCount.split(':')[0]})`, 'u'),
    })
    .first()
    .click();
}
// A member with a login, made by the signed-in administrator, signed in from a second context.
async function member(page: Page, browser: Browser) {
  const suffix = crypto.randomUUID();
  const created = await api(page, '/admin/users', 'POST', {
    name: `Member ${suffix.slice(0, 8)}`,
    email: `capture-${suffix}@example.test`,
    role: 'member',
  });
  expect(created.status).toBe(201);
  const context = await browser.newContext({ baseURL: laneBaseURL() });
  const other = await context.newPage();
  await other.goto('/login');
  await other.getByLabel(en.auth.email).fill(created.body.data.email);
  await other.getByLabel(en.auth.password).fill(created.body.meta.temporaryPassword);
  await other.getByRole('button', { name: en.auth.login, exact: true }).click();
  await expect(other).toHaveURL(/home/u);
  return { other, close: () => context.close() };
}
test('CAPTURES-A01 a recording made from Home is waiting in Review after leaving, and its draft shows there (en)', async ({
  page,
}) => {
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const captureId = await recordByUpload(page, en);
  await page.goto('/notes');
  await openReview(page, en);
  const group = page.locator(`[aria-labelledby="capture-${captureId}"]`);
  await expect(group).toHaveCount(1);
  await expect(group.getByText(en.captures.unavailable)).toBeVisible();
  // The badge counts a recording that failed (here: AI is off, so a typed transcript cannot be
  // interpreted), deferred from the recorder's own release.
  const before: number = (await api(page, '/captures/count')).body.data.pending;
  await group.getByRole('button', { name: en.captures.typeTranscript }).click();
  await group.getByRole('textbox', { name: en.captures.transcriptLabel }).fill('Send the quote.');
  await group.getByRole('button', { name: en.captures.saveTranscript }).click();
  await expect(group.getByText(en.captures.failedOther)).toBeVisible();
  // Closes the desktop side panel, so the header is in reach again; harmless on the page.
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('link', { name: fill(en.captures.reviewCount, { count: before + 1 }) }),
  ).toBeVisible();
  seedDrafts(captureId);
  await page.goto('/captures');
  await expect(page.locator(`[aria-labelledby="capture-${captureId}"]`)).toHaveCount(1);
  await expect(
    page
      .locator(`[aria-labelledby="capture-${captureId}"]`)
      .getByRole('heading', { name: 'Send the updated supplier quote' }),
  ).toBeVisible();
});
test('CAPTURES-A02 of two drafts from one recording, one approved and one discarded make exactly one live record (en)', async ({
  page,
}) => {
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const captureId = await recordByUpload(page, en);
  seedDrafts(captureId);
  await page.goto('/captures');
  const card = (kind: string) =>
    page.locator(`[data-testid="suggestion-card"][data-kind="${kind}"]`).first();
  const task = card('task');
  await task.getByRole('button', { name: en.captures.approve, exact: true }).click();
  await expect(
    page.getByText(fill(en.captures.approvedTask, { title: 'Send the updated supplier quote' })),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: en.captures.view, exact: true })).toBeVisible();
  const note = card('meeting_note');
  await note.getByRole('button', { name: en.captures.discard }).click();
  // Discard asks nothing first: the only dialogs on the page are the toasts themselves.
  await expect(page.getByText(en.captures.discarded)).toBeVisible();
  await expect(
    page.locator('[role="dialog"]:not([data-slot="toast"]), [role="alertdialog"]'),
  ).toHaveCount(0);
  const capture = await api(page, `/captures/${captureId}`);
  const states = capture.body.data.suggestions.map((item: { kind: string; status: string }) => [
    item.kind,
    item.status,
  ]);
  expect(states.sort()).toEqual([
    ['meeting_note', 'discarded'],
    ['task', 'approved'],
  ]);
  const live = capture.body.data.suggestions.find(
    (item: { status: string }) => item.status === 'approved',
  );
  const notes = await api(
    page,
    `/notes?view=all&q=${encodeURIComponent('Warehouse expansion postponed')}`,
  );
  expect(notes.body.data).toEqual([]);
  const created = await api(page, `/tasks/${live.liveEntityId}`);
  expect(created.body.data.title).toBe('Send the updated supplier quote');
  await api(page, `/tasks/${live.liveEntityId}`, 'DELETE', {
    revision: created.body.data.revision,
  });
});
test('CAPTURES-A03 CAPTURES-A04 a member cannot open another person’s draft or its audio, and an administrator can open a member’s (en)', async ({
  page,
  browser,
}) => {
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const mine = await recordByUpload(page, en);
  const { other, close } = await member(page, browser);
  try {
    expect((await api(other, `/captures/${mine}`)).status).toBe(404);
    const audio = await other.request.get(`/api/v1/captures/${mine}/audio`);
    expect(audio.status()).toBe(404);
    expect((await api(other, '/captures?scope=all')).body.data).toEqual([]);
    await other.goto('/captures?scope=all');
    await expect(other.getByText(en.captures.emptyTitle)).toBeVisible();
    // The member's own recording, sent through the API as the recorder sends it.
    const theirs = await other.evaluate(
      async (bytes) => {
        const form = new FormData();
        form.set('file', new File([new Uint8Array(bytes)], 'member.wav'));
        form.set('durationSeconds', '1');
        const response = await fetch('/api/v1/captures', {
          method: 'POST',
          headers: { 'X-Requested-With': 'Enan', 'Idempotency-Key': crypto.randomUUID() },
          body: form,
        });
        return (await response.json()).data.id as string;
      },
      [...wav()],
    );
    seedDrafts(theirs);
    expect((await api(page, `/captures/${theirs}`)).status).toBe(200);
    expect((await page.request.get(`/api/v1/captures/${theirs}/audio`)).status()).toBe(200);
    await page.goto('/captures?scope=all');
    // One section per recording: a hydration mismatch once left the streamed copy beside it.
    await expect(page.locator(`[aria-labelledby="capture-${theirs}"]`)).toHaveCount(1);
    await expect(page.locator(`[aria-labelledby="capture-${theirs}"]`)).toBeVisible();
  } finally {
    await close();
  }
});
test('CAPTURES-A08 from Review the recorder deletes a recording AI could not take, Undo brings it back, and another member gets 404 (en)', async ({
  page,
  browser,
}) => {
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const captureId = await recordByUpload(page, en);
  const { other, close } = await member(page, browser);
  try {
    expect((await api(other, `/captures/${captureId}`, 'DELETE')).status).toBe(404);
    await page.goto('/captures');
    const group = page.locator(`[data-capture="${captureId}"]`);
    await expect(page.locator(`[data-capture="${captureId}"]`)).toHaveCount(1);
    await expect(group.getByText(en.captures.unavailable)).toBeVisible();
    const deleted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/captures/${captureId}` &&
        response.request().method() === 'DELETE',
    );
    await group.getByRole('button', { name: en.captures.deleteRecording }).click();
    const response = await deleted;
    expect(response.status()).toBe(204);
    const opId = response.headers()['x-op-id'] ?? '';
    await expect(group).toHaveCount(0);
    await expect(page.getByText(en.captures.recordingDeleted, { exact: true })).toBeVisible();
    // Another member can neither restore it nor learn it exists.
    const denied = await api(other, `/captures/${captureId}/restore`, 'POST', { opId });
    expect(denied.status).toBe(404);
    expect(denied.body.error).toMatchObject({
      code: 'not_found',
      details: { entityType: 'capture' },
    });
    await page.getByRole('button', { name: en.common.undo }).click();
    await expect(page.getByText(en.captures.recordingRestored)).toBeVisible();
    await expect(page.locator(`[data-capture="${captureId}"]`)).toHaveCount(1);
    await expect(group.getByText(en.captures.unavailable)).toBeVisible();
    // Focus lands on the restored group's first action, its play button, never on the page.
    await expect(group.getByRole('button', { name: en.captures.playRecording })).toBeFocused();
  } finally {
    await close();
  }
});
// CAPTURES-A11: a recording still transcribing is deleted from its More actions menu; its job then
// ends while it is deleted (the stand-in publishes an empty result, as the fence leaves it), and
// Undo brings it back failed, with Retry, rather than transcribing forever.
test('CAPTURES-A11 a recording deleted while it transcribes comes back from Undo failed, with Retry (en)', async ({
  page,
}) => {
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const captureId = await recordByUpload(page, en);
  seedDrafts(captureId, 'processing');
  await page.goto('/captures');
  const group = page.locator(`[data-capture="${captureId}"]`);
  await expect(group).toHaveCount(1);
  await expect(group.getByText(en.captures.transcribing)).toBeVisible();
  await group.getByRole('button', { name: en.captures.moreActions }).click();
  await page
    .locator("[data-slot='popover-content']")
    .getByRole('button', { name: en.captures.deleteRecording })
    .click();
  await expect(group).toHaveCount(0);
  await expect(page.getByText(en.captures.recordingDeleted, { exact: true })).toBeVisible();
  seedDrafts(captureId, 'finished');
  await page.getByRole('button', { name: en.common.undo }).click();
  await expect(page.getByText(en.captures.recordingRestored)).toBeVisible();
  await expect(group).toHaveCount(1);
  await expect(group.getByText(en.captures.failedInterrupted)).toBeVisible();
  await expect(group.getByRole('button', { name: en.captures.playRecording })).toBeFocused();
  await expect(group.getByRole('button', { name: en.captures.retry })).toBeVisible();
  await expect(group.getByText(en.captures.transcribing)).toHaveCount(0);
});
// CAPTURES-A09: the Review menu sits over dense text, so it takes the popover's opaque surface:
// the elevated ground with no glass image or blur, in night and under reduced transparency, while
// the default popovers (the account menu) keep their glass. Read from computed style.
test('CAPTURES-A09 the More actions menu is opaque in night and under reduced transparency, and other popovers keep their glass (en) @desktop', async ({
  page,
}) => {
  const style = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          color: computed.backgroundColor,
          image: computed.backgroundImage,
          filter: computed.backdropFilter,
        };
      });
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/u);
  const captureId = await recordByUpload(page, en);
  seedDrafts(captureId);
  await page.goto('/captures');
  const group = page.locator(`[data-capture="${captureId}"]`);
  await expect(group).toHaveCount(1);
  await group.getByRole('button', { name: en.captures.moreActions }).click();
  const menu = "[data-slot='popover-content'][data-surface='elevated']";
  await expect(page.locator(menu)).toBeVisible();
  expect(await style(menu)).toEqual({ color: 'rgb(35, 35, 38)', image: 'none', filter: 'none' });
  await page.keyboard.press('Escape');
  await expect(page.locator(menu)).toHaveCount(0);
  // The account menu is the default glass: a translucent tint over a blur.
  await page.getByRole('button', { name: en.common.account, exact: true }).click();
  const glass = "[data-slot='popover-content'][data-surface='glass']";
  await expect(page.locator(glass)).toBeVisible();
  const account = await style(glass);
  expect(account.color).toBe('rgba(48, 48, 60, 0.5)');
  expect(account.filter).not.toBe('none');
  await page.keyboard.press('Escape');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await group.getByRole('button', { name: en.captures.moreActions }).click();
  await expect(page.locator(menu)).toBeVisible();
  await expect
    .poll(() => style(menu))
    .toEqual({
      color: 'rgb(42, 42, 46)',
      image: 'none',
      filter: 'none',
    });
});
// CAPTURES-A10: on a phone the toast stands above the floating microphone while it is shown, and
// drops back once it is not (the recorder open); on a desktop, where there is no such button, the
// toast keeps its own place.
// Every toast viewport on the page (the shell's and any nested host) obeys the same rule.
const toastBottoms = (page: Page) =>
  page
    .locator("[data-slot='toast-viewport']")
    .evaluateAll((elements) =>
      elements.map((element) => parseFloat(getComputedStyle(element).bottom)),
    );
test('CAPTURES-A10 on a phone the toast clears the floating microphone only while it is shown (en) @mobile', async ({
  page,
}) => {
  // A working (silent) microphone, so the recorder runs and the phone button gives way to it.
  await page.addInitScript(() => {
    localStorage.setItem('enan.captures.microphone-intro', '1');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => new AudioContext().createMediaStreamDestination().stream,
      },
    });
  });
  await loginAs(page, 'en');
  const fab = page.locator('[data-capture-fab]');
  await expect(fab).toBeVisible();
  const top = await fab.evaluate((element) => element.getBoundingClientRect().top);
  const height = await page.evaluate(() => window.innerHeight);
  const lifted = await toastBottoms(page);
  expect(lifted.length).toBeGreaterThan(0);
  for (const bottom of lifted) expect(height - bottom).toBeLessThanOrEqual(top);
  await fab.click();
  await expect(page.getByTestId('capture-clock')).not.toHaveText('00:00');
  await expect(page.locator('[data-capture-fab]')).toHaveCount(0);
  await expect
    .poll(async () => (await toastBottoms(page)).every((bottom) => height - bottom > top))
    .toBe(true);
  await page.getByRole('button', { name: en.captures.cancel }).click();
  await expect(fab).toBeVisible();
  await expect.poll(async () => toastBottoms(page)).toEqual(lifted);
});
test('CAPTURES-A10 on a desktop the hidden microphone does not lift the toast (en) @desktop', async ({
  page,
}) => {
  await loginAs(page, 'en');
  await expect(page.locator('[data-capture-fab]')).toBeHidden();
  const bottoms = await toastBottoms(page);
  expect(bottoms.length).toBeGreaterThan(0);
  for (const bottom of bottoms) expect(bottom).toBe(32);
});
for (const [locale, m, dir] of [
  ['en', en, 'ltr'],
  ['ar', ar, 'rtl'],
] as const)
  test(`CAPTURES-A06 Review and the recorder read the approved copy in ${dir.toUpperCase()} (${locale})`, async ({
    page,
  }) => {
    await refuseMicrophone(page);
    await loginAs(page, locale);
    await page.goto('/captures');
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.getByRole('heading', { level: 1, name: m.captures.review })).toBeVisible();
    await page
      .getByRole('button', { name: m.captures.recordNote })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page.getByText(m.captures.permissionTitle)).toBeVisible();
    await expect(page.getByText(m.captures.permissionBody)).toBeVisible();
    await page.getByRole('button', { name: m.captures.notNow }).click();
  });
// CAPTURES-A07: a working microphone (a silent Web Audio stream), so the phone recorder runs. It is a
// modal, and the page, the bar and the skip link behind it are inert, so Tab and Shift+Tab cycle
// inside it. Past the last control focus leaves the document for the browser's own controls (the
// body is active), as it does from a native modal dialog; it never lands on the page.
test('CAPTURES-A07 on a phone Tab and Shift+Tab never leave the recorder while it records (ar) @mobile', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('enan.captures.microphone-intro', '1');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => new AudioContext().createMediaStreamDestination().stream,
      },
    });
  });
  await loginAs(page, 'ar');
  await page.goto('/tasks?view=all');
  await page
    .getByRole('button', { name: ar.captures.recordNote })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole('dialog', { name: ar.captures.recorderLabel });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('capture-clock')).not.toHaveText('00:00');
  await expect(page.locator('.app-canvas')).toHaveAttribute('inert', '');
  await expect(page.locator('nav.mobile-navigation')).toHaveAttribute('inert', '');
  const inside = () =>
    dialog.evaluate((node) => {
      const active = document.activeElement;
      return active === document.body || (node !== active && node.contains(active));
    });
  for (const key of ['Tab', 'Shift+Tab'])
    for (let press = 0; press < 20; press++) {
      await page.keyboard.press(key);
      expect(await inside(), `${key} #${press + 1}`).toBe(true);
    }
  // Past five seconds Cancel asks first (S6); discarding from there gives the page back too.
  await expect(page.getByTestId('capture-clock')).toHaveText(/^00:(0[6-9]|[1-5]\d)$/u);
  await page.getByRole('button', { name: ar.captures.cancel }).click();
  await page.getByRole('button', { name: ar.captures.discardRecording }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.app-canvas')).not.toHaveAttribute('inert');
  await expect(page.locator('nav.mobile-navigation')).not.toHaveAttribute('inert');
});
