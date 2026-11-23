// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '@/core/i18n/messages/en.json';
import { AppShell } from '@/ui/layout/AppShell';
import { HydrationMark } from '@/ui/layout/HydrationMark';
import type { CaptureSetup } from '@/modules/captures/schema/validation';
// ADR 0072 CAPTURES-B17 CAPTURES-B18: the record controls are chosen on the server and handed to
// the shell as props, so hydrating it renders each of them once more and never again: nothing
// moves a control after paint. Each variant is stood in for by a counter; the recorder and the
// header's Review, which read the network and the microphone, by nothing.
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock('@/modules/captures/ui/CaptureEntry', () => {
  const counted = (name: string) =>
    function Counted(props: object) {
      renders.set(name, (renders.get(name) ?? 0) + 1);
      return <span data-entry={name} data-props={JSON.stringify(props)} />;
    };
  return {
    CaptureEntry: {
      Floating: counted('Floating'),
      MoreAction: counted('MoreAction'),
      MoreDot: counted('MoreDot'),
      Header: counted('Header'),
      MenuAction: counted('MenuAction'),
      Inbox: counted('Inbox'),
    },
  };
});
vi.mock('@/modules/captures/ui/CaptureHost', () => ({ CaptureHost: () => null }));
vi.mock('@/modules/captures/ui/CaptureHeaderButton', () => ({
  CaptureHeaderControls: ({ record }: { record: ReactNode }) => record,
}));
vi.mock('@/modules/notifications/ui', () => ({ NotificationBell: () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => {
  renders.clear();
  delete document.documentElement.dataset.hydrated;
});
const user = { id: 'reader', name: 'Reader', email: 'reader@example.test', role: 'member' };
async function hydrate(capture: CaptureSetup) {
  const client = new QueryClient();
  const app = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <QueryClientProvider client={client}>
        <AppShell user={user} workspace="Office" capture={capture}>
          <HydrationMark part="page" />
        </AppShell>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(app());
  document.body.append(container);
  const recoverable = vi.fn();
  const root = await act(async () =>
    hydrateRoot(container, app(), { onRecoverableError: recoverable }),
  );
  return {
    container,
    recoverable,
    done: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
const base: CaptureSetup = {
  allowed: true,
  enabled: true,
  shortcut: true,
  mobile: 'floating-start',
  desktop: 'account-menu',
};
it('ADR 0072 CAPTURES-B17 CAPTURES-B18 hydrating the shell renders each record control once, as the server chose it', async () => {
  const view = await hydrate(base);
  // Once on the server, once while hydrating; the menu action waits in the closed, lazy menu.
  expect(Object.fromEntries(renders)).toEqual({ Floating: 2 });
  const floating = view.container.querySelector('[data-entry="Floating"]');
  expect(floating?.getAttribute('data-props')).toBe('{"side":"start"}');
  expect(view.recoverable).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.hydrated).toBe('1');
  view.done();
});
it('ADR 0072 CAPTURES-B17 In More puts the action and the dot in the bar, and the header button in the header', async () => {
  const view = await hydrate({ ...base, mobile: 'more', desktop: 'header' });
  expect(Object.fromEntries(renders)).toEqual({ MoreDot: 2, Header: 2 });
  expect(view.recoverable).not.toHaveBeenCalled();
  view.done();
});
it('ADR 0072 CAPTURES-B14 with recording off no control renders and the shell is still marked ready', async () => {
  const view = await hydrate({ ...base, allowed: false, enabled: false, shortcut: false });
  expect(renders.size).toBe(0);
  expect(document.documentElement.dataset.hydrated).toBe('1');
  view.done();
});
