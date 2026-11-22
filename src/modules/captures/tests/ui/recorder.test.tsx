// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { CaptureHost } from '../../ui/CaptureHost';
import { CaptureFab } from '../../ui/CaptureFab';
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
const media = vi.hoisted(() => ({ desktop: false, recorder: null as null | { state: string } }));
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
  localStorage.clear();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') && media.desktop,
    addEventListener: () => {},
    removeEventListener: () => {},
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const recorder = () => screen.queryByRole('form', { name: en.captures.recorderLabel });
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
it('CAPTURES-B01 S8 at 15:00 the recording stops, is sent as a capture and the limit toast says so', async () => {
  await startRecording();
  await elapse(900);
  expect(spies.send).toHaveBeenCalledTimes(1);
  const form = spies.send.mock.calls[0]?.[0];
  expect(form).toBeInstanceOf(FormData);
  expect(form.get('durationSeconds')).toBe('900');
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
