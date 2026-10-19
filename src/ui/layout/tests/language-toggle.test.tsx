// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { LanguageToggle } from '../LanguageToggle';
import { mount } from '../../../../tests/fixtures/mount';

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/core/http/client', () => ({ request: http.request }));
const reload = vi.fn();
vi.stubGlobal('location', { ...window.location, reload });
afterEach(() => {
  http.request.mockReset();
  reload.mockReset();
});

it('ACCT-B04 the header language toggle is a radio group with each language named in its own tongue', () => {
  mount(<LanguageToggle />, 'ar');
  const group = screen.getByRole('radiogroup', { name: ar.common.language });
  const options = screen.getAllByRole('radio');
  expect(group).toBeTruthy();
  expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
    ar.common.english,
    ar.common.arabic,
  ]);
  expect(options.map((option) => option.getAttribute('lang'))).toEqual(['en', 'ar']);
  expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  // Only the language in use is in the tab order, as in any radio group.
  expect(options.map((option) => option.tabIndex)).toEqual([-1, 0]);
});

it('ACCT-B04 choosing the other language saves it and reloads; choosing the current one does nothing', async () => {
  http.request.mockResolvedValue({ data: null });
  mount(<LanguageToggle />, 'en');
  fireEvent.click(screen.getByRole('radio', { name: en.common.english }));
  expect(http.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: en.common.arabic }));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(http.request).toHaveBeenCalledWith('/preferences', expect.anything(), {
    method: 'POST',
    body: { locale: 'ar' },
  });
});

it('ACCT-B04 an arrow key moves to the other language and chooses it', async () => {
  http.request.mockResolvedValue({ data: null });
  mount(<LanguageToggle />, 'en');
  fireEvent.keyDown(screen.getByRole('radio', { name: en.common.english }), { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: en.common.arabic }));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(http.request.mock.calls[0]?.[2]).toEqual({ method: 'POST', body: { locale: 'ar' } });
});

it('ACCT-B04 a refused save is told beside the toggle and the page is not reloaded', async () => {
  http.request.mockRejectedValue(new Error(en.errors.internal));
  mount(<LanguageToggle />, 'en');
  fireEvent.click(screen.getByRole('radio', { name: en.common.arabic }));
  expect((await screen.findByRole('alert')).textContent).toBe(en.errors.internal);
  expect(reload).not.toHaveBeenCalled();
});
