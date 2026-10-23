// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// The network is the only seam: the two hooks share a real QueryClient, so what is asserted is that
// a command keeps the page asking until the updater's answer changes, and that it then stops.
const http = vi.hoisted(() => ({ request: vi.fn(), lastCheckAt: '2026-09-10T08:55:00Z' }));
vi.mock('@/core/http/client', () => ({
  request: http.request,
  ApiError: class ApiError extends Error {},
}));
import { useCommand, useUpdates } from '../../ui/update-queries';

// A new object on every request, equal while the updater says the same, as the API answers.
const answer = () => ({
  data: {
    health: 'running',
    history: [],
    commands: true,
    outdated: false,
    status: {
      channel: 'latest',
      state: 'checked',
      lastCheckAt: http.lastCheckAt,
      paused: false,
      automatic: false,
      confirm: false,
      intervalSeconds: 86400,
    },
  },
});
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  http.lastCheckAt = '2026-09-10T08:55:00Z';
  http.request
    .mockReset()
    .mockImplementation(async (...[, , init]: [string, object, { method?: string }?]) =>
      init?.method === 'POST' ? { data: { command: 'check' } } : answer(),
    );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const reads = () => http.request.mock.calls.filter(([, , init]) => init?.method !== 'POST').length;

it('ADMIN-B58 after a command the page asks until the updater answers, and otherwise not at all', async () => {
  renderHook(() => useUpdates(), { wrapper });
  await act(() => vi.advanceTimersByTimeAsync(10));
  expect(reads()).toBe(1);
  // Nothing sent: the page does not ask again.
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(reads()).toBe(1);
  const { result } = renderHook(() => useCommand(), { wrapper });
  await act(() => result.current.mutateAsync({ command: 'check' }));
  await act(() => vi.advanceTimersByTimeAsync(10));
  const afterSend = reads();
  expect(afterSend).toBeGreaterThan(1);
  // The same answer: still waiting, so it asks again.
  await act(() => vi.advanceTimersByTimeAsync(3_100));
  expect(reads()).toBeGreaterThan(afterSend);
  // The updater has checked: one more read brings the answer, then the page stops.
  http.lastCheckAt = '2026-09-10T09:00:01Z';
  await act(() => vi.advanceTimersByTimeAsync(3_100));
  const answered = reads();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(reads()).toBe(answered);
});
