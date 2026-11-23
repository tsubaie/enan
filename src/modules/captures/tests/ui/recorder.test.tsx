// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { CaptureHost } from '../../ui/CaptureHost';
import { CaptureFab } from '../../ui/CaptureFab';
import { CaptureHeaderControls } from '../../ui/CaptureHeaderButton';
import { ApiError } from '@/core/http/client';
import { mount } from '../../../../../tests/fixtures/mount';
// CAPTURES-B01: the shell's recorder with the browser's microphone, recorder, clock and screen
// stood in for, so the recorder's own timing and keys are what run. Nothing reaches a server: the
// upload is a spy.
const spies = vi.hoisted(() => ({ send: vi.fn(), toast: vi.fn() }));
vi.mock('../../ui/capture-queries', () => ({
  useCreateCapture: () => ({ mutate: spies.send, isPending: false }),
  useCapture: () => ({ data: undefined }),
  useCaptureCount: () => ({ data: undefined }),
}));
vi.mock('@/ui/primitives/toast', () => ({ useToastManager: () => ({ add: spies.toast }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(),
}));
const media = vi.hoisted(() => ({
  desktop: false,
  recorder: null as null | { state: string },
  listeners: new Set<() => void>(),
}));
class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    media.recorder = this;
  }
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['spoken words']) });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  spies.send.mockReset();
  spies.toast.mockReset();
  media.desktop = false;
  media.listeners.clear();
  localStorage.clear();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') && media.desktop,
    addEventListener: (_type: string, listener: () => void) => media.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => media.listeners.delete(listener),
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
});
afterEach(() => {
  // Unmounted while the stand-ins are still in place, so a pending frame is cleared by its own kind.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
// Only the desktop form is a named region; on a phone the dialog around it carries the name.
const recorder = () => document.querySelector<HTMLFormElement>('form[data-placement]');
async function startRecording(locale: 'en' | 'ar' = 'en') {
  localStorage.setItem('enan.captures.microphone-intro', '1');
  mount(
    <>
      <CaptureHost />
      <CaptureFab />
    </>,
    locale,
  );
  const messages = locale === 'ar' ? ar : en;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messages.captures.recordNote }));
  });
}
const elapse = (seconds: number) => act(() => vi.advanceTimersByTimeAsync(seconds * 1000));
it('CAPTURES-B01 S2 the first start asks first, says the audio leaves when transcription is on, then records', async () => {
  mount(
    <>
      <CaptureHost />
      <CaptureFab />
    </>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.captures.recordNote }));
  });
  expect(screen.getByText(en.captures.permissionTitle)).toBeTruthy();
  expect(screen.getByText(en.captures.permissionBody)).toBeTruthy();
  expect(en.captures.permissionBody).toContain('the audio is sent to be turned into text');
  expect(recorder()).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.captures.continue }));
  });
  expect(recorder()).not.toBeNull();
  expect(localStorage.getItem('enan.captures.microphone-intro')).toBe('1');
});
it('CAPTURES-B01 S6 a cancel within five seconds discards at once; after five it asks first', async () => {
  await startRecording();
  await elapse(3);
  fireEvent.click(screen.getByRole('button', { name: en.captures.cancel }));
  expect(recorder()).toBeNull();
  expect(screen.queryByText(en.captures.cancelTitle)).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.captures.recordNote }));
  });
  await elapse(7);
  fireEvent.click(screen.getByRole('button', { name: en.captures.cancel }));
  expect(screen.getByText(en.captures.cancelTitle)).toBeTruthy();
  expect(media.recorder?.state).toBe('paused');
  fireEvent.click(screen.getByRole('button', { name: en.captures.discardRecording }));
  expect(recorder()).toBeNull();
  expect(spies.send).not.toHaveBeenCalled();
});
it('CAPTURES-B01 S7 the length warning appears at about one minute and does not stop the recording', async () => {
  await startRecording();
  await elapse(59);
  expect(screen.queryByText(en.captures.lengthWarning)).toBeNull();
  await elapse(2);
  expect(screen.getByText(en.captures.lengthWarning)).toBeTruthy();
  expect(media.recorder?.state).toBe('recording');
});
it('CAPTURES-B01 S8 a second before 15:00 the recording stops, is sent as a capture and the limit toast says so', async () => {
  await startRecording();
  await elapse(898);
  expect(spies.send).not.toHaveBeenCalled();
  await elapse(1);
  expect(spies.send).toHaveBeenCalledTimes(1);
  const form = spies.send.mock.calls[0]?.[0];
  expect(form).toBeInstanceOf(FormData);
  expect(form.get('durationSeconds')).toBe('899');
  expect(form.get('file')).toBeInstanceOf(File);
  expect(spies.toast).toHaveBeenCalledWith({ title: en.captures.limitReached });
});
it('CAPTURES-B01 S10 Escape on a desktop pauses and offers three choices with Keep recording as the default', async () => {
  media.desktop = true;
  await startRecording();
  await elapse(10);
  const form = recorder();
  if (!form) throw new Error('no recorder');
  fireEvent.keyDown(form, { key: 'Escape' });
  expect(screen.getByText(en.captures.escapeTitle)).toBeTruthy();
  expect(media.recorder?.state).toBe('paused');
  for (const name of [en.captures.stopAndSave, en.captures.discardRecording])
    expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
  const keep = screen.getByRole('button', { name: en.captures.keepRecording });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(document.activeElement).toBe(keep);
  fireEvent.click(keep);
  expect(media.recorder?.state).toBe('recording');
  expect(recorder()).not.toBeNull();
  expect(spies.send).not.toHaveBeenCalled();
});
it('CAPTURES-B01 in Arabic the clock, the meter and the microphone are not mirrored', async () => {
  await startRecording('ar');
  await elapse(28);
  const clock = screen.getByTestId('capture-clock');
  expect(clock.getAttribute('dir')).toBe('ltr');
  expect(clock.textContent).toBe('00:28');
  expect(screen.getByTestId('capture-meter').getAttribute('dir')).toBe('ltr');
  expect(document.querySelector('[class*="rtl:-scale-x"], [class*="rtl:rotate"]')).toBeNull();
  expect(screen.getByText(ar.captures.recording)).toBeTruthy();
});
it('CAPTURES-B01 S9 Alt+V starts a recording, but not while a field has focus or with another modifier', async () => {
  localStorage.setItem('enan.captures.microphone-intro', '1');
  mount(
    <>
      <input aria-label={en.common.search} />
      <CaptureHost />
    </>,
  );
  const field = screen.getByRole('textbox', { name: en.common.search });
  field.focus();
  await act(async () => {
    fireEvent.keyDown(field, { code: 'KeyV', key: '√', altKey: true });
    fireEvent.keyDown(document.body, { code: 'KeyV', key: 'v', altKey: true, ctrlKey: true });
    fireEvent.keyDown(document.body, { code: 'KeyV', key: 'v' });
  });
  expect(recorder()).toBeNull();
  await act(async () => {
    fireEvent.keyDown(document.body, { code: 'KeyV', key: '√', altKey: true });
  });
  expect(recorder()).not.toBeNull();
});
const refuse = (details: Record<string, string>, code = 'rule_violation') =>
  spies.send.mockImplementation((_form: FormData, handlers: { onError: (e: Error) => void }) =>
    handlers.onError(new ApiError(code, 'Request refused', details, 'request')),
  );
const keys = ['tooLong', 'tooLarge', 'unsupportedType'] as const;
it.each([
  [{ reason: 'too_long' }, 'rule_violation', keys[0]],
  [{ reason: 'too_large' }, 'rule_violation', keys[1]],
  [{ reason: 'unsupported_type' }, 'rule_violation', keys[2]],
  [{}, 'too_large', keys[1]],
])(
  'CAPTURES-B12 a recording refused with %o (%s) says why at high priority and stays held for Retry',
  async (details, code, key) => {
    refuse(details, code);
    await startRecording();
    await elapse(3);
    fireEvent.click(screen.getByRole('button', { name: en.captures.stop }));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(spies.toast).toHaveBeenCalledWith({ title: en.captures[key], priority: 'high' });
    expect(screen.getByText(en.captures[key])).toBeTruthy();
    const file = spies.send.mock.calls[0]?.[0].get('file');
    fireEvent.click(screen.getByRole('button', { name: en.captures.retry }));
    expect(spies.send).toHaveBeenCalledTimes(2);
    expect(spies.send.mock.calls[1]?.[0].get('file')).toBe(file);
  },
);
it('CAPTURES-B12 a file from the refused-microphone sheet that the server refuses reopens the sheet with the reason and focus on Upload audio', async () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.reject(new Error('NotAllowedError')) },
  });
  refuse({ reason: 'unsupported_type' });
  await startRecording('ar');
  expect(screen.getByText(ar.captures.refusedTitle)).toBeTruthy();
  const input = screen.getByTestId('capture-file');
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(['<html>'], 'memo.m4a')] } });
  });
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(spies.send).toHaveBeenCalledTimes(1);
  expect(screen.getByText(ar.captures.refusedTitle)).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe(ar.captures.unsupportedType);
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: ar.captures.uploadAudio }),
  );
  expect(spies.toast).not.toHaveBeenCalled();
});
it('CAPTURES-B01 the phone and desktop recorders stand on a solid surface, so the page and the bar never show through', async () => {
  await startRecording();
  expect(recorder()?.className).toMatch(/\bbg-elevated\b/u);
  expect(recorder()?.className).not.toMatch(/\bbg-(bg|popover)\b/u);
  fireEvent.click(screen.getByRole('button', { name: en.captures.cancel }));
  media.desktop = true;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.captures.recordNote }));
  });
  expect(recorder()?.getAttribute('data-placement')).toBe('desktop-floating');
  expect(recorder()?.className).toMatch(/\bbg-elevated\b/u);
});
it('CAPTURES-B01 on a phone the recorder is a modal: the page and the bar behind it are inert until it closes, stops or unmounts', async () => {
  const canvas = document.body.appendChild(document.createElement('div'));
  canvas.className = 'app-canvas';
  const nav = document.body.appendChild(document.createElement('nav'));
  nav.className = 'mobile-navigation';
  const skip = document.body.appendChild(document.createElement('a'));
  skip.href = '#content';
  const behind = () => [canvas, nav, skip].every((node) => node.hasAttribute('inert'));
  const live = () => [canvas, nav, skip].every((node) => !node.hasAttribute('inert'));
  localStorage.setItem('enan.captures.microphone-intro', '1');
  const start = () =>
    act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.captures.recordNote }));
    });
  const view = mount(
    <>
      <CaptureHost />
      <CaptureFab />
    </>,
  );
  await start();
  const dialog = screen.getByRole('dialog', { name: en.captures.recorderLabel });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.contains(recorder())).toBe(true);
  expect(behind()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: en.captures.cancel }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(live()).toBe(true);
  await start();
  expect(behind()).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: en.captures.stop }));
  });
  expect(recorder()).toBeNull();
  expect(live()).toBe(true);
  view.unmount();
  const again = mount(
    <>
      <CaptureHost />
      <CaptureFab />
    </>,
  );
  await start();
  expect(behind()).toBe(true);
  again.unmount();
  expect(live()).toBe(true);
  for (const node of [canvas, nav, skip]) node.remove();
});
it('CAPTURES-B01 on a desktop the floating recorder is not a dialog and leaves the page live', async () => {
  const canvas = document.body.appendChild(document.createElement('div'));
  canvas.className = 'app-canvas';
  media.desktop = true;
  await startRecording();
  expect(recorder()?.getAttribute('data-placement')).toBe('desktop-floating');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(canvas.hasAttribute('inert')).toBe(false);
  canvas.remove();
});
// The shell's page and bar, for the scenarios that check what the phone dialog makes inert.
function shell() {
  const canvas = document.body.appendChild(document.createElement('div'));
  canvas.className = 'app-canvas';
  const nav = document.body.appendChild(document.createElement('nav'));
  nav.className = 'mobile-navigation';
  return {
    inert: () => [canvas, nav].every((node) => node.hasAttribute('inert')),
    live: () => [canvas, nav].every((node) => !node.hasAttribute('inert')),
    remove: () => [canvas, nav].forEach((node) => node.remove()),
  };
}
const fab = () => screen.getByRole('button', { name: en.captures.recordNote });
it('CAPTURES-B01 on a phone a cancel within five seconds returns focus to the record button', async () => {
  await startRecording();
  await elapse(3);
  fireEvent.click(screen.getByRole('button', { name: en.captures.cancel }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(document.activeElement).toBe(fab());
});
it('CAPTURES-B01 on a phone a cancel after five seconds, then Discard, returns focus to the record button', async () => {
  await startRecording();
  await elapse(7);
  fireEvent.click(screen.getByRole('button', { name: en.captures.cancel }));
  fireEvent.click(screen.getByRole('button', { name: en.captures.discardRecording }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(recorder()).toBeNull();
  expect(document.activeElement).toBe(fab());
});
it('CAPTURES-B01 on a desktop a cancel returns focus to the header Record a note button', async () => {
  media.desktop = true;
  localStorage.setItem('enan.captures.microphone-intro', '1');
  mount(
    <>
      <CaptureHeaderControls />
      <CaptureHost />
    </>,
  );
  const header = screen.getByRole('button', { name: new RegExp(en.captures.recordNote, 'u') });
  await act(async () => {
    fireEvent.click(header);
  });
  expect(recorder()?.getAttribute('data-placement')).toBe('desktop-floating');
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${en.captures.cancel}`, 'u') }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(document.activeElement).toBe(header);
});
it('CAPTURES-B01 a switch from phone to desktop mid-recording frees the page and the bar; back to phone makes them inert again', async () => {
  const page = shell();
  await startRecording();
  expect(page.inert()).toBe(true);
  const resize = (desktop: boolean) =>
    act(() => {
      media.desktop = desktop;
      for (const listener of media.listeners) listener();
    });
  resize(true);
  expect(recorder()?.getAttribute('data-placement')).toBe('desktop-floating');
  expect(page.live()).toBe(true);
  resize(false);
  expect(recorder()?.getAttribute('data-placement')).toBe('mobile-fullscreen');
  expect(page.inert()).toBe(true);
  page.remove();
});
it('CAPTURES-B01 under StrictMode the phone dialog makes the page inert while open, frees it on close and unmount, and still returns focus', async () => {
  const page = shell();
  localStorage.setItem('enan.captures.microphone-intro', '1');
  const start = () =>
    act(async () => {
      fireEvent.click(fab());
    });
  const view = mount(
    <StrictMode>
      <CaptureHost />
      <CaptureFab />
    </StrictMode>,
  );
  await start();
  expect(screen.getByRole('dialog', { name: en.captures.recorderLabel })).toBeTruthy();
  expect(page.inert()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: en.captures.cancel }));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(page.live()).toBe(true);
  expect(document.activeElement).toBe(fab());
  await start();
  expect(page.inert()).toBe(true);
  view.unmount();
  expect(page.live()).toBe(true);
  page.remove();
});
