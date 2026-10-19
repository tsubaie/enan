// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useChartMotion } from '../motion';
// KPIS-B29: the marks move only for a reader who has not asked for less motion, and follow the
// preference when it changes while the chart is open.
function stubPreference(reduced: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: reduced,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const matchMedia = vi.fn(() => media);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    change(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
}
function Probe() {
  const motion = useChartMotion();
  return <output>{motion.active ? 'moving' : 'still'}</output>;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('KPIS-B29 charts animate when the reader has not asked for reduced motion', () => {
  const preference = stubPreference(false);
  render(<Probe />);
  expect(screen.getByRole('status').textContent).toBe('moving');
  expect(preference.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
});
it('KPIS-B29 under prefers-reduced-motion every mark is drawn at rest, and a change is followed', () => {
  const preference = stubPreference(true);
  render(<Probe />);
  expect(screen.getByRole('status').textContent).toBe('still');
  act(() => preference.change(false));
  expect(screen.getByRole('status').textContent).toBe('moving');
  act(() => preference.change(true));
  expect(screen.getByRole('status').textContent).toBe('still');
});
