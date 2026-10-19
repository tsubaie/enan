// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import en from '@/core/i18n/messages/en.json';
import { Providers } from '@/ui/layout/Providers';
// EP-B18: the query client lives in the app's providers, which the signed-in layout keys on the
// user, so a different user gets a client with nothing in it. Its defaults are what make every
// list refetch when the window is looked at again and every sixty seconds while it is visible —
// and not while it is hidden.
let visibility: DocumentVisibilityState = 'visible';
function Probe({ seen, fetcher }: { seen: QueryClient[]; fetcher: () => Promise<number> }) {
  const client = useQueryClient();
  if (!seen.includes(client)) seen.push(client);
  useQuery({ queryKey: ['measures', 'list'], queryFn: fetcher });
  return null;
}
// The root layout puts the message context around the providers; the toast host inside reads it.
function App({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {children}
    </NextIntlClientProvider>
  );
}
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
describe('query client lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    // The theme provider asks about the system theme on mount; jsdom has no media queries.
    window.matchMedia ??= () =>
      ({
        matches: false,
        media: '',
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }) as MediaQueryList;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  it('EP-B18 lists refetch every sixty seconds while visible, pause while hidden, and refetch on focus', async () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    render(
      <App>
        <Providers>
          <Probe seen={[]} fetcher={fetcher} />
        </Providers>
      </App>,
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Hidden: the interval keeps ticking and fetches nothing.
    visibility = 'hidden';
    window.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Looked at again: one refetch for the focus, then the sixty-second cadence resumes.
    visibility = 'visible';
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('EP-B18 a provider keyed on another user is a new client that has none of the old cache', async () => {
    const seen: QueryClient[] = [];
    const fetcher = vi.fn().mockResolvedValue(1);
    const view = render(
      <App>
        <Providers key="user-a">
          <Probe seen={seen} fetcher={fetcher} />
        </Providers>
      </App>,
    );
    await settle();
    const first = seen[0];
    expect(first?.getQueryData(['measures', 'list'])).toBe(1);
    // Same user re-rendering keeps the client and its cache.
    view.rerender(
      <App>
        <Providers key="user-a">
          <Probe seen={seen} fetcher={fetcher} />
        </Providers>
      </App>,
    );
    await settle();
    expect(seen).toHaveLength(1);
    // Another user signing in gets a client with nothing in it, and the list is fetched afresh.
    view.rerender(
      <App>
        <Providers key="user-b">
          <Probe seen={seen} fetcher={fetcher} />
        </Providers>
      </App>,
    );
    await settle();
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen[1]?.getQueryCache()).not.toBe(first?.getQueryCache());
  });
});
