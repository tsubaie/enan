import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { loginAs } from './fixtures/auth';
import { gotoReady, reloadReady, waitReady } from './fixtures/ready';
import { fill } from './fixtures/messages';
import { laneBaseURL } from './lanes';
import { seedDrafts } from './fixtures/captures';
import en from '../src/core/i18n/messages/en.json' with { type: 'json' };
import ar from '../src/core/i18n/messages/ar.json' with { type: 'json' };
// CAPTURES-A01–A04, A06–A19 (A05 is NOTES-A15). AI is off in the browser suite, so a recording is
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
// One after-Stop toast (CAPTURES-B20), by what it says.
const toastWith = (page: Page, text: string) =>
  page.locator('[data-slot="toast"]').filter({ hasText: text });
// S1/S9 → S2 → S3: start from wherever the page is and upload instead (the microphone is refused).
// The intro (S2) is asked once per browser, so a later recording goes straight to the S3 sheet.
async function upload(page: Page, m: typeof en) {
  await page
    .getByRole('button', { name: m.captures.recordNote })
    .filter({ visible: true })
    .first()
    .click();
  const intro = page.getByRole('button', { name: m.captures.continue });
  const sheet = page.getByText(m.captures.refusedTitle);
  await expect(intro.or(sheet)).toBeVisible();
  if (await intro.isVisible()) await intro.click();
  await expect(sheet).toBeVisible();
  await page
    .getByTestId('capture-file')
    .setInputFiles({ name: 'hallway.wav', mimeType: 'audio/wav', buffer: wav() });
}
// CAPTURES-B20: AI is off here, so a recording lands saved but not transcribed; its warning stays
// until it is closed, which this does. The primitive keeps a toast's Close out of the accessibility
// tree until the stack is hovered or focused, hence `includeHidden`.
async function recordByUpload(page: Page, m: typeof en) {
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/captures' && response.status() === 201,
  );
  await upload(page, m);
  const captureId: string = (await (await created).json()).data.id;
  const warning = toastWith(page, m.captures.unavailable);
  await warning.getByRole('button', { name: m.common.close, includeHidden: true }).click();
  await expect(warning).toHaveCount(0);
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
// CAPTURES-B16: the signed-in reader's own placement, through the account they already have.
async function placement(page: Page, captures: object) {
  const me = await api(page, '/account');
  const answer = await api(page, '/account', 'PATCH', {
    revision: me.body.data.user.revision,
    captures,
  });
  expect(answer.status).toBe(200);
}
async function workspacePlacement(page: Page, phone: string, computer: string) {
  for (const [key, value] of [
    ['captures.default_mobile_placement', phone],
    ['captures.default_desktop_placement', computer],
  ])
    expect((await api(page, '/admin/settings', 'PATCH', { key, value })).status).toBe(200);
}
// A member with a login, made by the signed-in administrator, signed in from a second context.
async function member(page: Page, browser: Browser, options: BrowserContextOptions = {}) {
  const suffix = crypto.randomUUID();
  const created = await api(page, '/admin/users', 'POST', {
    name: `Member ${suffix.slice(0, 8)}`,
    email: `capture-${suffix}@example.test`,
    role: 'member',
  });
  expect(created.status).toBe(201);
  const context = await browser.newContext({ ...options, baseURL: laneBaseURL() });
  const other = await context.newPage();
  await other.goto('/login');
  await other.getByLabel(en.auth.email).fill(created.body.data.email);
  await other.getByLabel(en.auth.password).fill(created.body.meta.temporaryPassword);
  await other.getByRole('button', { name: en.auth.login, exact: true }).click();
  await expect(other).toHaveURL(/home/u);
  await waitReady(other);
  return { other, close: () => context.close() };
}
test('CAPTURES-A01 a recording made from Home is waiting in Review after leaving, and its draft shows there (en)', async ({
  page,
}) => {
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const captureId = await recordByUpload(page, en);
  await gotoReady(page, '/notes');
  await openReview(page, en);
  const group = page.locator(`[aria-labelledby="capture-${captureId}"]`);
  await expect(group).toHaveCount(1);
  await expect(group.getByText(en.captures.waitingTranscription)).toBeVisible();
  // The badge counts a recording that failed (here: AI is off, so a typed transcript cannot be
  // interpreted), deferred from the recorder's own release. With transcription off the card does
  // not offer typing (CAPTURES-B22); the server still takes it (CAPTURES-B23).
  const before: number = (await api(page, '/captures/count')).body.data.pending;
  const typed = await api(page, `/captures/${captureId}/transcript`, 'POST', {
    transcript: 'Send the quote.',
  });
  expect(typed.status).toBe(200);
  await gotoReady(page, '/captures');
  await expect(group.getByText(en.captures.failedOther)).toBeVisible();
  await expect(
    page.getByRole('link', { name: fill(en.captures.reviewCount, { count: before + 1 }) }),
  ).toBeVisible();
  seedDrafts(captureId);
  await gotoReady(page, '/captures');
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
  await gotoReady(page, '/captures');
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
    await gotoReady(other, '/captures?scope=all');
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
    await gotoReady(page, '/captures?scope=all');
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
    await gotoReady(page, '/captures');
    const group = page.locator(`[data-capture="${captureId}"]`);
    await expect(page.locator(`[data-capture="${captureId}"]`)).toHaveCount(1);
    await expect(group.getByText(en.captures.waitingTranscription)).toBeVisible();
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
    await expect(group.getByText(en.captures.waitingTranscription)).toBeVisible();
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
  await gotoReady(page, '/captures');
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
  await gotoReady(page, '/captures');
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
for (const side of ['end', 'start'] as const)
  test(`CAPTURES-A10 on a phone the toast clears the floating microphone (${side}) only while it is shown (en) @mobile`, async ({
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
    await placement(page, { mobile: 'floating', side });
    try {
      await reloadReady(page);
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
    } finally {
      await placement(page, { mobile: 'workspace', side: 'end' });
    }
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
    await gotoReady(page, '/captures');
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
  await gotoReady(page, '/tasks?view=all');
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
// CAPTURES-A12: the workspace switch off hides every way to record, says so in Review, keeps the
// drafts reviewable and refuses new audio on the server. The setting is put back whatever happens.
async function recording(page: Page, value: boolean) {
  const answer = await api(page, '/admin/settings', 'PATCH', { key: 'captures.enabled', value });
  expect(answer.status).toBe(200);
}
for (const [locale, m] of [
  ['en', en],
  ['ar', ar],
] as const)
  test(`CAPTURES-A12 CAPTURES-B14 an administrator turns voice capture off: no circle, header button, shortcut or inbox Record; the note shows; a draft can still be approved; POST /captures answers 403 (${locale})`, async ({
    page,
  }) => {
    await refuseMicrophone(page);
    await loginAs(page, locale);
    const captureId = await recordByUpload(page, m);
    seedDrafts(captureId);
    try {
      await recording(page, false);
      await gotoReady(page, '/home');
      await expect(page.locator('[data-capture-fab]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: m.captures.recordNote })).toHaveCount(0);
      await expect(page.locator('[aria-keyshortcuts]')).toHaveCount(0);
      await page.keyboard.press('Alt+KeyV');
      await expect(page.getByText(m.captures.permissionTitle)).toHaveCount(0);
      await gotoReady(page, '/captures');
      await expect(
        page.getByRole('note').filter({ hasText: m.captures.recordingOffTitle }),
      ).toContainText(m.captures.recordingOffBody);
      await expect(page.getByRole('button', { name: m.captures.recordNote })).toHaveCount(0);
      const group = page.locator(`[aria-labelledby="capture-${captureId}"]`);
      const task = group.locator('[data-testid="suggestion-card"][data-kind="task"]').first();
      await task.getByRole('button', { name: m.captures.approve, exact: true }).click();
      await expect(
        page.getByText(fill(m.captures.approvedTask, { title: 'Send the updated supplier quote' })),
      ).toBeVisible();
      const refused = await page.evaluate(async () => {
        const form = new FormData();
        form.set('file', new Blob(['not audio']), 'note.wav');
        const response = await fetch('/api/v1/captures', {
          method: 'POST',
          headers: { 'X-Requested-With': 'Enan', 'Idempotency-Key': crypto.randomUUID() },
          body: form,
        });
        return { status: response.status, body: await response.json() };
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error.details).toMatchObject({
        reason: 'recording_off',
        scope: 'workspace',
      });
      const approved = (await api(page, `/captures/${captureId}`)).body.data.suggestions.find(
        (item: { status: string }) => item.status === 'approved',
      );
      const live = await api(page, `/tasks/${approved.liveEntityId}`);
      await api(page, `/tasks/${approved.liveEntityId}`, 'DELETE', {
        revision: live.body.data.revision,
      });
    } finally {
      await recording(page, true);
    }
  });
// The text of the dialog that holds focus, if any: a recorder's sheet opened from a closing sheet or
// menu must keep it.
const focusedDialog = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.textContent ?? '');
// CAPTURES-A13: on a phone the circle sits at the logical end or start, measured against the
// screen's edges in both directions; it gives way to a record's sheet and to the keyboard; In More
// it is the sheet's first action and the More tab carries a dot while drafts wait.
const box = async (page: Page) => {
  const rect = await page.locator('[data-capture-fab]').boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(rect).not.toBeNull();
  return { left: rect!.x, right: width - rect!.x - rect!.width };
};
for (const [locale, m] of [
  ['en', en],
  ['ar', ar],
] as const)
  test(`CAPTURES-A13 CAPTURES-B17 on a phone the circle sits at End, moves to Start, hides for a sheet and the keyboard, and In More is the sheet's first action with the More dot (${locale}) @mobile`, async ({
    page,
  }) => {
    await refuseMicrophone(page);
    await loginAs(page, locale);
    const captureId = await recordByUpload(page, m);
    seedDrafts(captureId);
    try {
      await placement(page, { mobile: 'floating', side: 'end' });
      await reloadReady(page);
      const end = await box(page);
      // End is the inline end: right in English, left in Arabic.
      if (locale === 'en') expect(end.right).toBeLessThan(end.left);
      else expect(end.left).toBeLessThan(end.right);
      expect(Math.min(end.left, end.right)).toBeLessThanOrEqual(24);
      await placement(page, { side: 'start' });
      await reloadReady(page);
      const start = await box(page);
      if (locale === 'en') expect(start.left).toBeLessThan(start.right);
      else expect(start.right).toBeLessThan(start.left);
      expect(Math.min(start.left, start.right)).toBeLessThanOrEqual(24);
      // The page reserves the circle's ground: scrolled to its end, the last row (the Voice
      // capture footer and what follows it) sits above the circle on either side.
      for (const side of ['start', 'end'] as const) {
        await placement(page, { mobile: 'floating', side });
        await gotoReady(page, '/account');
        await expect(page.getByText(m.account.voiceSaved)).toBeAttached();
        const clear = await page.evaluate(() => {
          const main = document.querySelector('#content') as HTMLElement;
          main.scrollTo(0, main.scrollHeight);
          const last = main.lastElementChild?.getBoundingClientRect().bottom ?? 0;
          const circle = document.querySelector('[data-capture-fab]')?.getBoundingClientRect().top;
          return { last, circle: circle ?? 0 };
        });
        expect(clear.last).toBeLessThanOrEqual(clear.circle + 1);
      }
      // The Review title keeps one line beside Record and Approve N ready on a phone.
      await gotoReady(page, '/captures');
      const title = page.locator('[data-inbox] h1');
      expect(
        await title.evaluate(
          (h1) =>
            h1.getBoundingClientRect().height < parseFloat(getComputedStyle(h1).lineHeight) * 1.5,
        ),
      ).toBe(true);
      // A record's sheet hides the bar, and the circle with it.
      await gotoReady(page, '/tasks?new=1');
      await expect(page.locator('.entity-page-open')).toHaveCount(1);
      await expect(page.locator('[data-capture-fab]')).toBeHidden();
      // A focused field means the on-screen keyboard is up.
      await gotoReady(page, '/account');
      const fab = page.locator('[data-capture-fab]');
      await expect(fab).toBeVisible();
      const field = page.locator('#content input[type="text"], #content input:not([type])').first();
      await field.focus();
      await expect(fab).toBeHidden();
      await field.blur();
      await expect(fab).toBeVisible();
      // In More: no circle, Record first in the sheet with the reader's count, and the dot. The
      // account menu holds Record on a computer, which must not take the phone's focus back.
      await placement(page, { mobile: 'more', desktop: 'account-menu' });
      await gotoReady(page, '/home');
      await expect(page.locator('[data-capture-fab]')).toHaveCount(0);
      const door = page.locator('nav.mobile-navigation button[data-capture-opener]');
      await expect(door.locator('[data-capture-dot]')).toBeVisible();
      await expect(
        page.locator('nav.mobile-navigation a, nav.mobile-navigation button'),
      ).toHaveCount(5);
      await door.click();
      const sheet = page.getByRole('dialog');
      const first = sheet.getByRole('button').first();
      await expect(first).toContainText(m.captures.recordNote);
      await expect(first.locator('bdi').first()).toBeVisible();
      await first.click();
      // The sheet closed in the same click, and did not take focus from the recorder's own sheet
      // (the intro was seen during the upload, so the refused microphone is what it says).
      await expect(sheet.filter({ hasText: m.common.navMoreDescription })).toHaveCount(0);
      await expect.poll(() => focusedDialog(page)).toContain(m.captures.refusedTitle);
      await page.keyboard.press('Escape');
      await expect(page.getByText(m.captures.refusedTitle)).toHaveCount(0);
      await expect(door).toBeFocused();
    } finally {
      await placement(page, { mobile: 'workspace', side: 'end', desktop: 'workspace' });
    }
  });
// CAPTURES-A14: on a computer Record moves from the header to the top of the account menu, then
// leaves only Alt+V with the inbox naming it.
test('CAPTURES-A14 CAPTURES-B18 on a computer Record lives in the header, then in the account menu as its top action, then only on Alt+V with the inbox hint (en) @desktop', async ({
  page,
}) => {
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const header = page.locator('header').getByRole('button', { name: /Record a note/u });
  try {
    await placement(page, { desktop: 'header' });
    await reloadReady(page);
    await expect(header).toBeVisible();
    await expect(header).toHaveAttribute('aria-keyshortcuts', 'Alt+V');
    await placement(page, { desktop: 'account-menu' });
    await reloadReady(page);
    await expect(header).toHaveCount(0);
    const avatar = page.getByRole('button', { name: en.common.account, exact: true });
    await avatar.click();
    const menu = page.locator('[data-slot="popover-content"]');
    const first = menu.getByRole('button').first();
    await expect(first).toContainText(en.captures.recordNote);
    await expect(first.locator('kbd')).toHaveText(en.captures.shortcut);
    await first.click();
    // The menu closed in the same click and the recorder's sheet holds focus, not the avatar.
    await expect(menu).toHaveCount(0);
    await expect.poll(() => focusedDialog(page)).toContain(en.captures.permissionTitle);
    await page.getByRole('button', { name: en.captures.notNow }).click();
    await expect(avatar).toBeFocused();
    await placement(page, { desktop: 'hidden' });
    await reloadReady(page);
    await expect(header).toHaveCount(0);
    await avatar.click();
    await expect(menu).toBeVisible();
    await expect(menu.getByText(en.captures.recordNote)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await gotoReady(page, '/captures');
    const inbox = page.locator('[data-inbox] > header');
    await expect(inbox.getByRole('button', { name: en.captures.record })).toBeVisible();
    await expect(inbox.getByText('Press Alt+V to record')).toBeVisible();
    await page.locator('body').press('Alt+KeyV');
    await expect(page.getByText(en.captures.permissionTitle)).toBeVisible();
    await page.getByRole('button', { name: en.captures.notNow }).click();
    await expect(inbox.getByRole('button', { name: en.captures.record })).toBeFocused();
  } finally {
    await placement(page, { desktop: 'workspace' });
  }
});
// CAPTURES-A15: a member on Workspace default follows the administrator's new default; one who
// chose Floating, Start keeps it.
test('CAPTURES-A15 CAPTURES-B16 a member on Workspace default follows the administrator’s new default; a member who chose Floating, Start does not move (en) @mobile', async ({
  page,
  browser,
}) => {
  await loginAs(page, 'en');
  // The project's phone, for the two members' own contexts.
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const following = await member(page, browser, phone);
  const chosen = await member(page, browser, phone);
  try {
    await placement(chosen.other, { mobile: 'floating', side: 'start' });
    await workspacePlacement(page, 'more', 'account-menu');
    await reloadReady(following.other);
    await expect(following.other.locator('[data-capture-fab]')).toHaveCount(0);
    await following.other.locator('nav.mobile-navigation button[data-capture-opener]').click();
    await expect(following.other.getByRole('dialog').getByRole('button').first()).toContainText(
      en.captures.recordNote,
    );
    await reloadReady(chosen.other);
    await expect(chosen.other.locator('[data-capture-fab]')).toBeVisible();
    const start = await box(chosen.other);
    expect(start.left).toBeLessThan(start.right);
  } finally {
    await workspacePlacement(page, 'floating-end', 'header');
    await following.close();
    await chosen.close();
  }
});
for (const [locale, m] of [
  ['en', en],
  ['ar', ar],
] as const)
  test(`CAPTURES-A16 CAPTURES-B20 after Stop the reader stays on the page with no sheet: the unavailable warning stays until closed, a failed upload keeps Retry and Discard and Retry succeeds, and a processed recording says so (${locale})`, async ({
    page,
  }) => {
    await refuseMicrophone(page);
    // The page's own clock, so "stays" and "about five seconds" are shown without waiting.
    await page.clock.install();
    await loginAs(page, locale);
    await gotoReady(page, '/tasks');
    // Saved without a transcript: the warning, and nothing in front of the page.
    await upload(page, m);
    const warning = toastWith(page, m.captures.unavailable);
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('data-tone', 'warning');
    await expect(warning.getByRole('link', { name: m.captures.view })).toHaveAttribute(
      'href',
      '/captures',
    );
    await expect(page).toHaveURL(/\/tasks$/u);
    await page.clock.fastForward(60_000);
    await expect(warning).toBeVisible();
    await expect(
      page.locator(
        '[role="dialog"]:not([data-slot="toast"]), [role="alertdialog"]:not([data-slot="toast"])',
      ),
    ).toHaveCount(0);
    // The upload fails once: the audio is held with Discard and Retry, and Retry sends it.
    let refused = false;
    await page.route('**/api/v1/captures', async (route) => {
      if (route.request().method() !== 'POST' || refused) return route.continue();
      refused = true;
      await route.abort('internetdisconnected');
    });
    await upload(page, m);
    const failed = toastWith(page, m.captures.uploadFailedTitle);
    await expect(failed).toBeVisible();
    await expect(failed).toContainText(m.captures.uploadFailedBody);
    await expect(failed.locator('button')).toHaveText([m.captures.discard, m.captures.retry]);
    const resent = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/captures' && response.status() === 201,
    );
    await failed.locator('button', { hasText: m.captures.retry }).click();
    await resent;
    await expect(failed).toHaveCount(0);
    await expect(toastWith(page, m.captures.unavailable)).toHaveCount(1);
    await page.unroute('**/api/v1/captures');
    // As if transcription had started: the first on this device explains itself and stays; the
    // next says it is processing, with View, and goes by itself while the warning stays.
    await page.route('**/api/v1/captures', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, data: { ...body.data, status: 'transcribing' } },
      });
    });
    await upload(page, m);
    const first = toastWith(page, m.captures.firstRunTitle);
    await expect(first).toContainText(m.captures.education);
    await expect(first.getByRole('link', { name: m.captures.howItWorks })).toHaveAttribute(
      'href',
      '/captures',
    );
    // One persistent notice at a time: the first-run toast took the warning's place.
    await expect(toastWith(page, m.captures.unavailable)).toHaveCount(0);
    await first.getByRole('button', { name: m.common.close, includeHidden: true }).click();
    await upload(page, m);
    const processing = toastWith(page, m.captures.processingTitle);
    await expect(processing.getByRole('link', { name: m.captures.view })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.fastForward(4_000);
    await expect(processing).toHaveCount(1);
    await page.clock.fastForward(2_000);
    await expect(processing).toHaveCount(0);
    await page.unroute('**/api/v1/captures');
  });
for (const [locale, m, line] of [
  ['en', en, '2 recordings ready to review'],
  ['ar', ar, 'تسجيلان جاهزان للمراجعة'],
] as const)
  test(`CAPTURES-A16b CAPTURES-B21 two ready recordings make one bell line reading "${line}" (${locale})`, async ({
    page,
    browser,
  }) => {
    await loginAs(page, 'en');
    const { other, close } = await member(page, browser);
    try {
      await other.context().addCookies([{ name: 'eos_locale', value: locale, url: laneBaseURL() }]);
      await refuseMicrophone(other);
      await reloadReady(other);
      const first = await recordByUpload(other, m);
      const second = await recordByUpload(other, m);
      seedDrafts(first);
      seedDrafts(second);
      await reloadReady(other);
      await other.getByRole('button', { name: m.notifications.title }).first().click();
      const centre = other.getByRole('dialog');
      await expect(centre.getByText(line, { exact: true })).toHaveCount(1);
      await expect(centre.getByText(m.captures.education)).toHaveCount(0);
      await expect(centre.getByRole('button').filter({ hasText: line })).toContainText(
        m.notifications.updated.replace('{time}', '').trim(),
      );
    } finally {
      await close();
    }
  });
// CAPTURES-A17: AI is off in the browser suite, which is transcription switched off: the waiting
// card says why (the administrator with the way to AI settings), Retry and Type the transcript are
// aria-disabled, described by that reason and send nothing, and Delete recording with Undo works.
for (const [locale, m] of [
  ['en', en],
  ['ar', ar],
] as const) {
  test(`CAPTURES-A17 CAPTURES-B22 a recording AI could not take waits for transcription with the member reason, the administrator sees the settings reason with Open settings, and Retry and Type the transcript are aria-disabled while it is off (${locale})`, async ({
    page,
    browser,
  }) => {
    await refuseMicrophone(page);
    await loginAs(page, locale);
    const captureId = await recordByUpload(page, m);
    await gotoReady(page, '/captures');
    const group = page.locator(`[data-capture="${captureId}"]`);
    await expect(group.getByText(m.captures.waitingTranscription)).toBeVisible();
    const reason = page.locator(`#capture-${captureId}-reason`);
    await expect(reason).toContainText(m.captures.transcriptionOffAdmin);
    await expect(reason.getByRole('link', { name: m.captures.openAiSettings })).toHaveAttribute(
      'href',
      '/admin/ai',
    );
    const actions = [m.captures.retry, m.captures.typeTranscript].map((name) =>
      group.getByRole('button', { name }),
    );
    let sent = 0;
    page.on('request', (request) => {
      if (/\/api\/v1\/captures\/[^/]+\/(transcribe|interpret|transcript)$/u.test(request.url()))
        sent += 1;
    });
    for (const action of actions) {
      await expect(action).toHaveAttribute('aria-disabled', 'true');
      await expect(action).toHaveAttribute('aria-describedby', `capture-${captureId}-reason`);
      await action.focus();
      await expect(action).toBeFocused();
      // Playwright refuses to click what is aria-disabled; a reader can still press it.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
    }
    await expect(group.getByRole('button', { name: m.captures.typeTranscript })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(group.getByRole('textbox')).toHaveCount(0);
    expect(sent).toBe(0);
    await group.getByRole('button', { name: m.captures.deleteRecording }).click();
    await expect(group).toHaveCount(0);
    await page.getByRole('button', { name: m.common.undo }).click();
    await expect(group.getByText(m.captures.waitingTranscription)).toBeVisible();
    // A member reads the member line about their own recording, with no link.
    const { other, close } = await member(page, browser);
    try {
      await other.context().addCookies([{ name: 'eos_locale', value: locale, url: laneBaseURL() }]);
      await refuseMicrophone(other);
      await reloadReady(other);
      const theirs = await recordByUpload(other, m);
      await gotoReady(other, '/captures');
      const line = other.locator(`#capture-${theirs}-reason`);
      await expect(line).toHaveText(m.captures.transcriptionUnavailable);
      await expect(line.getByRole('link')).toHaveCount(0);
      await expect(
        other.locator(`[data-capture="${theirs}"]`).getByRole('button', { name: m.captures.retry }),
      ).toHaveAttribute('aria-disabled', 'true');
    } finally {
      await close();
    }
  });
}
// CAPTURES-A18: a recording that failed (here, restored after its job ended while it was deleted)
// takes a typed transcript; AI cannot prepare drafts from it, and the words stay: the failed card
// shows them after a reload, and Retry asks for interpretation of them, never transcription.
test('CAPTURES-A18 CAPTURES-B23 a transcript typed while drafts cannot be prepared is kept, and Retry prepares drafts from it (en)', async ({
  page,
}) => {
  const typed = 'Send the risk report before the committee meets on Sunday.';
  await refuseMicrophone(page);
  await loginAs(page, 'en');
  const captureId = await recordByUpload(page, en);
  seedDrafts(captureId, 'processing');
  await gotoReady(page, '/captures');
  const group = page.locator(`[data-capture="${captureId}"]`);
  await group.getByRole('button', { name: en.captures.moreActions }).click();
  await page
    .locator("[data-slot='popover-content']")
    .getByRole('button', { name: en.captures.deleteRecording })
    .click();
  await expect(group).toHaveCount(0);
  seedDrafts(captureId, 'finished');
  await page.getByRole('button', { name: en.common.undo }).click();
  await expect(group.getByText(en.captures.failedInterrupted)).toBeVisible();
  const toggle = group.getByRole('button', { name: en.captures.typeTranscript });
  await toggle.click();
  const field = group.getByRole('textbox', { name: en.captures.transcriptLabel });
  await expect(field).toBeFocused();
  await field.fill(typed);
  const saved = page.waitForResponse((response) =>
    response.url().endsWith(`/api/v1/captures/${captureId}/transcript`),
  );
  await group.getByRole('button', { name: en.captures.saveTranscript }).click();
  expect((await saved).status()).toBe(200);
  await expect(group.getByText(en.captures.failedOther)).toBeVisible();
  await reloadReady(page);
  await expect(group.getByText(en.captures.failedOther)).toBeVisible();
  await group.getByText(en.captures.fullTranscript).click();
  await expect(group.getByText(typed)).toBeVisible();
  const retried = page.waitForRequest((request) =>
    /\/api\/v1\/captures\/[^/]+\/(interpret|transcribe)$/u.test(request.url()),
  );
  await group.getByRole('button', { name: en.captures.retry }).click();
  expect((await retried).url()).toMatch(new RegExp(`/captures/${captureId}/interpret$`, 'u'));
  await reloadReady(page);
  await group.getByText(en.captures.fullTranscript).click();
  await expect(group.getByText(typed)).toBeVisible();
});
// CAPTURES-A19: the typed transcript saved with the keyboard alone. AI is off in the browser suite,
// so the capture ends failed and focus lands on its Retry, never on the page (the heading outcome,
// drafts being prepared, needs AI and is covered by the inbox unit test).
for (const [locale, m] of [
  ['en', en],
  ['ar', ar],
] as const) {
  test(`CAPTURES-A19 CAPTURES-B25 saving a typed transcript with the keyboard puts focus on Retry when the capture fails (${locale})`, async ({
    page,
  }) => {
    await refuseMicrophone(page);
    await loginAs(page, locale);
    const captureId = await recordByUpload(page, m);
    seedDrafts(captureId, 'processing');
    await gotoReady(page, '/captures');
    const group = page.locator(`[data-capture="${captureId}"]`);
    await group.getByRole('button', { name: m.captures.moreActions }).click();
    await page
      .locator("[data-slot='popover-content']")
      .getByRole('button', { name: m.captures.deleteRecording })
      .click();
    await expect(group).toHaveCount(0);
    seedDrafts(captureId, 'finished');
    await page.getByRole('button', { name: m.common.undo }).click();
    await expect(group.getByText(m.captures.failedInterrupted)).toBeVisible();
    await group.getByRole('button', { name: m.captures.typeTranscript }).focus();
    await page.keyboard.press('Enter');
    const field = group.getByRole('textbox', { name: m.captures.transcriptLabel });
    await expect(field).toBeFocused();
    await page.keyboard.type('Send the risk report before Sunday.');
    await page.keyboard.press('Tab');
    await expect(group.getByRole('button', { name: m.captures.saveTranscript })).toBeFocused();
    const saved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/captures/${captureId}/transcript`),
    );
    await page.keyboard.press('Enter');
    expect((await saved).status()).toBe(200);
    await expect(group.getByText(m.captures.failedOther)).toBeVisible();
    await expect(group.getByRole('button', { name: m.captures.retry })).toBeFocused();
    await expect(group.getByRole('textbox')).toHaveCount(0);
  });
}
