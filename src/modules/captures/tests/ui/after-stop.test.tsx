// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import { ToastHost } from '@/ui/layout/toast/ToastHost';
import { useToastManager } from '@/ui/primitives/toast';
import { useAfterStop } from '../../ui/after-stop-toasts';
import { useLeaveWarning } from '../../ui/outbox';
import { mount } from '../../../../../tests/fixtures/mount';
// CAPTURES-B20: what the reader is told after Stop. The upload is a spy the scenario answers; the
// toasts are the shell's own host, so their roles, timers and actions are the real ones.
const spies = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../ui/capture-queries', () => ({
  useCreateCapture: () => ({ mutateAsync: spies.send }),
}));
type Answer = { resolve: (status: string) => void; reject: (error: Error) => void };
let answers: Answer[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  answers = [];
  spies.send.mockReset().mockImplementation(
    () =>
      new Promise((resolve, reject) =>
        answers.push({
          resolve: (status) => resolve({ data: { id: crypto.randomUUID(), status } }),
          reject,
        }),
      ),
  );
});
afterEach(() => vi.useRealTimers());
const firstRunKey = 'enan.captures.first-run:v1';
const settle = () => act(() => vi.advanceTimersByTimeAsync(50));
// The shell as far as after-Stop goes: a field that holds focus, a delete receipt raised by another
// part of the app, and a Stop that hands a recording to the hook.
function Harness() {
  const after = useAfterStop();
  const manager = useToastManager();
  useLeaveWarning();
  return (
    <>
      <input aria-label={en.common.search} />
      <button
        type="button"
        onClick={() => after.record(new File(['spoken'], 'voice.webm'), 12, null)}
      >
        {en.captures.stop}
      </button>
      <button
        type="button"
        onClick={() => manager.add({ title: en.captures.recordingDeleted, timeout: 0 })}
      >
        {en.captures.deleteRecording}
      </button>
    </>
  );
}
function start(locale: 'en' | 'ar' = 'en') {
  mount(
    <ToastHost>
      <Harness />
    </ToastHost>,
    locale,
  );
  screen.getByRole('textbox', { name: en.common.search }).focus();
}
async function stop() {
  fireEvent.click(screen.getByRole('button', { name: en.captures.stop }));
  await settle();
  return answers.at(-1) as Answer;
}
// An alert is also copied into a hidden live region; the toast is the copy inside a toast.
const toast = (title: string) =>
  screen
    .getAllByText(title)
    .map((node) => node.closest<HTMLElement>('[data-slot="toast"]'))
    .find(Boolean) as HTMLElement;
const buttonsIn = (node: HTMLElement) =>
  [...node.querySelectorAll('button, a')].map((item) => item.textContent?.trim());
const leaving = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
it('CAPTURES-B20 uploading shows an indeterminate bar with nothing to dismiss, then the first-run toast stays until closed', async () => {
  start();
  const upload = await stop();
  const uploading = toast(en.captures.uploadingTitle);
  const bar = uploading.querySelector('[role="progressbar"]');
  expect(bar?.getAttribute('aria-label')).toBe(en.captures.uploadingTitle);
  expect(bar?.hasAttribute('aria-valuenow')).toBe(false);
  expect(buttonsIn(uploading)).toEqual([]);
  upload.resolve('transcribing');
  await settle();
  const first = toast(en.captures.firstRunTitle);
  expect(first).toBe(uploading);
  expect(first.getAttribute('role')).toBe('dialog');
  expect(first.textContent).toContain(en.captures.firstRunBody);
  expect(first.textContent).toContain(en.captures.education);
  const how = screen.getByRole('link', { name: en.captures.howItWorks });
  expect(how.getAttribute('href')).toBe('/captures');
  expect(buttonsIn(first)).toEqual([en.captures.howItWorks, en.common.close]);
  expect(localStorage.getItem(firstRunKey)).toBe('1');
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByText(en.captures.firstRunTitle)).toBeTruthy();
  expect(spies.send.mock.calls[0]?.[0].get('durationSeconds')).toBe('12');
});
it('CAPTURES-B20 later recordings say they are processing for about five seconds, with View', async () => {
  localStorage.setItem(firstRunKey, '1');
  start();
  (await stop()).resolve('queued');
  await settle();
  const line = toast(en.captures.processingTitle);
  expect(line.getAttribute('role')).toBe('dialog');
  expect(buttonsIn(line)).toEqual([en.captures.view, en.common.close]);
  expect(screen.getByRole('link', { name: en.captures.view }).getAttribute('href')).toBe(
    '/captures',
  );
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(screen.queryByText(en.captures.processingTitle)).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(screen.queryByText(en.captures.processingTitle)).toBeNull();
});
it('CAPTURES-B20 a recording saved without transcription warns until closed and leaves the first-run toast for the next one (ar)', async () => {
  start('ar');
  (await stop()).resolve('needs_transcript');
  await settle();
  const warning = toast(ar.captures.unavailable);
  expect(warning.dataset.tone).toBe('warning');
  expect(ar.captures.unavailable).toContain('التفريغ');
  expect(buttonsIn(warning)).toEqual([ar.captures.view, ar.common.close]);
  // Its words take the whole width and View and Close sit on a row of their own.
  const content = warning.querySelector('[data-slot="toast-content"]');
  expect(content?.className).toMatch(/\bflex-wrap\b/u);
  expect(content?.firstElementChild?.className).toMatch(/\bbasis-full\b/u);
  expect(localStorage.getItem(firstRunKey)).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByText(ar.captures.unavailable)).toBeTruthy();
  (await stop()).resolve('transcribing');
  await settle();
  expect(screen.getByText(ar.captures.firstRunTitle)).toBeTruthy();
  // One persistent notice at a time: the first-run toast replaced the warning.
  await settle();
  expect(screen.queryByText(ar.captures.unavailable)).toBeNull();
});
it('CAPTURES-B20 a failed upload is an alert that keeps the file for Retry or Discard, and Retry sends the same file', async () => {
  localStorage.setItem(firstRunKey, '1');
  start();
  (await stop()).reject(new TypeError('Failed to fetch'));
  await settle();
  const failed = toast(en.captures.uploadFailedTitle);
  expect(failed.getAttribute('role')).toBe('alertdialog');
  expect(failed.textContent).toContain(en.captures.uploadFailedBody);
  expect(buttonsIn(failed)).toEqual([en.captures.discard, en.captures.retry]);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(toast(en.captures.uploadFailedTitle)).toBe(failed);
  const file = spies.send.mock.calls[0]?.[0].get('file');
  fireEvent.click(screen.getByRole('button', { name: en.captures.retry, hidden: true }));
  await settle();
  expect(spies.send).toHaveBeenCalledTimes(2);
  expect(spies.send.mock.calls[1]?.[0].get('file')).toBe(file);
  expect(toast(en.captures.uploadingTitle)).toBe(failed);
  (answers.at(-1) as Answer).resolve('queued');
  await settle();
  expect(screen.getByText(en.captures.processingTitle)).toBeTruthy();
});
it.each([
  [{ reason: 'too_large' }, 'rule_violation', 'tooLarge'],
  [{ reason: 'too_long' }, 'rule_violation', 'tooLong'],
  [{ reason: 'unsupported_type' }, 'rule_violation', 'unsupportedType'],
  [{ reason: 'recording_off', scope: 'workspace' }, 'forbidden', 'recordingOff'],
] as const)(
  'CAPTURES-B20 a recording refused with %o says why and offers only Discard',
  async (details, code, key) => {
    start();
    (await stop()).reject(new ApiError(code, 'Refused', details, 'request'));
    await settle();
    const refused = toast(en.captures[key]);
    expect(refused.getAttribute('role')).toBe('alertdialog');
    expect(buttonsIn(refused)).toEqual([en.captures.discard]);
    fireEvent.click(screen.getByRole('button', { name: en.captures.discard, hidden: true }));
    await settle();
    expect(document.querySelector('[data-slot="toast"]')).toBeNull();
    expect(spies.send).toHaveBeenCalledTimes(1);
  },
);
it('CAPTURES-B20 leaving warns while a recording uploads or is held after a failure, and not once it is sent or discarded', async () => {
  localStorage.setItem(firstRunKey, '1');
  start();
  expect(leaving()).toBe(false);
  const first = await stop();
  expect(leaving()).toBe(true);
  first.resolve('queued');
  await settle();
  expect(leaving()).toBe(false);
  (await stop()).reject(new TypeError('Failed to fetch'));
  await settle();
  expect(leaving()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: en.captures.discard, hidden: true }));
  await settle();
  expect(leaving()).toBe(false);
});
it('CAPTURES-B20 no after-Stop toast moves focus or closes the delete receipt', async () => {
  start();
  const field = screen.getByRole('textbox', { name: en.common.search });
  fireEvent.click(screen.getByRole('button', { name: en.captures.deleteRecording }));
  field.focus();
  (await stop()).resolve('needs_transcript');
  (await stop()).reject(new TypeError('Failed to fetch'));
  (await stop()).resolve('transcribing');
  await settle();
  expect(document.activeElement).toBe(field);
  // Two are shown at once; the receipt is kept (hidden behind the newer two), never closed.
  expect(screen.getByText(en.captures.recordingDeleted)).toBeTruthy();
  const shown = [...document.querySelectorAll('[data-slot="toast"]:not([data-limited])')];
  expect(shown).toHaveLength(2);
  // The held recording is let go, so no audio outlives the scenario.
  fireEvent.click(screen.getByRole('button', { name: en.captures.discard, hidden: true }));
  await settle();
});
