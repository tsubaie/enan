// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { SearchPalette } from '../SearchPalette';
import { ShellHeader } from '../ShellHeader';
import { closeSearchPalette, setSearchScope } from '../search-palette-store';
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// The palette is the only thing under test; the transport is stood in for so a scenario decides
// what each query answers and when.
const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/core/http/client', () => ({ request: http.request }));
// The header's other two utilities carry their own queries and are not what these scenarios ask.
vi.mock('@/modules/notifications/ui', () => ({ NotificationBell: () => null }));
vi.mock('../AccountMenu', () => ({ AccountMenu: () => null }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  act(() => {
    closeSearchPalette();
    setSearchScope(null);
  });
});
type Locale = 'en' | 'ar';
const messages = { en, ar };
function mount(node: ReactNode, locale: Locale = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}
// The rendered form of an ICU message, produced by the same translator the palette uses.
function Label({ id, values }: { id: 'searchUnavailable'; values: Record<string, number> }) {
  const t = useTranslations('common');
  return <output data-testid="expected-label">{t(id, values)}</output>;
}
const uuid = (n: number) => `01a0b000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const hit = (module: string, n: number, title: string, rank: 0 | 1 = 0) => ({
  module,
  id: uuid(n),
  title,
  subtitle: null,
  href: `/${module}?id=${uuid(n)}`,
  rank,
});
const answer = (hits: ReturnType<typeof hit>[], unavailable: string[] = []) => ({
  data: { hits, unavailable },
});
const palette = () => <SearchPalette open onOpenChange={vi.fn()} />;
const type = (value: string) =>
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } });
const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
it('SEARCH-B09 typing debounces at 200 ms and a superseded response never overwrites a newer one', async () => {
  vi.useFakeTimers();
  const pending = new Map<string, (value: ReturnType<typeof answer>) => void>();
  http.request.mockImplementation(
    (path: string) => new Promise((resolve) => pending.set(path, resolve)),
  );
  mount(palette());
  // Three keystrokes inside the window: nothing is sent until typing settles.
  for (const value of ['bu', 'bud', 'budg']) {
    type(value);
    await flush(150);
  }
  expect(http.request).not.toHaveBeenCalled();
  await flush(50);
  expect(http.request).toHaveBeenCalledTimes(1);
  expect(http.request.mock.calls[0]?.[0]).toBe('/search?q=budg');
  type('budget');
  await flush(200);
  expect(http.request).toHaveBeenCalledTimes(2);
  expect(http.request.mock.calls[1]?.[0]).toBe('/search?q=budget');
  // The newer request answers first; the older one arrives late and must not win.
  await act(async () => {
    pending.get('/search?q=budget')?.(answer([hit('tasks', 2, 'Budget review')]));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('button', { name: 'Budget review' })).toBeTruthy();
  await act(async () => {
    pending.get('/search?q=budg')?.(answer([hit('tasks', 1, 'Budgie care')]));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('button', { name: 'Budget review' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Budgie care' })).toBeNull();
});
it('SEARCH-B02 one character is not a question: the palette says so and sends nothing', async () => {
  vi.useFakeTimers();
  http.request.mockResolvedValue(answer([hit('tasks', 1, 'Anything')]));
  mount(palette());
  expect(screen.getByText(en.common.searchHint)).toBeTruthy();
  type('a');
  await flush(250);
  expect(http.request).not.toHaveBeenCalled();
  expect(screen.getByText(en.common.searchHint)).toBeTruthy();
  type('an');
  await flush(250);
  expect(http.request).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(en.common.searchHint)).toBeNull();
});
describe.each(['en', 'ar'] as const)('%s', (locale) => {
  const m = messages[locale];
  it(`SEARCH-B03 SEARCH-B07 hits are grouped under their module heading and opening one navigates to its href and closes the palette (${locale})`, async () => {
    http.request.mockResolvedValue(
      answer([
        hit('tasks', 1, 'Budget review'),
        hit('notes', 2, 'Budget minutes'),
        hit('tasks', 3, 'Budget memo', 1),
      ]),
    );
    const onOpenChange = vi.fn();
    mount(<SearchPalette open onOpenChange={onOpenChange} />, locale);
    type('budget');
    const tasks = await screen.findByRole('heading', { name: m.common.tasks });
    const notes = screen.getByRole('heading', { name: m.common.notes });
    const section = (heading: HTMLElement) => {
      const parent = heading.parentElement;
      if (!parent) throw new Error('heading without a section');
      return within(parent);
    };
    expect(
      section(tasks)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Budget review', 'Budget memo']);
    expect(section(notes).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Budget minutes' }));
    expect(router.push).toHaveBeenCalledWith(`/notes?id=${uuid(2)}`);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it(`SEARCH-B04 a failed provider is reported inline above the hits that did arrive, never as an empty result (${locale})`, async () => {
    http.request.mockResolvedValue(answer([hit('tasks', 1, 'Outage task')], ['kpis']));
    mount(
      <>
        {palette()}
        <Label id="searchUnavailable" values={{ modules: 1 }} />
      </>,
      locale,
    );
    type('outage');
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(screen.getByTestId('expected-label').textContent);
    expect(status.textContent).not.toBe('');
    expect(screen.getByRole('button', { name: 'Outage task' })).toBeTruthy();
    expect(screen.queryByText(m.common.searchEmpty)).toBeNull();
    // The line precedes the results.
    const button = screen.getByRole('button', { name: 'Outage task' });
    expect(status.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
it('SEARCH-B06 the palette shows every hit it was given and nothing else: no total, no count of what exists', async () => {
  const hits = Array.from({ length: 7 }, (_, n) => hit('tasks', n + 1, `Shown ${n + 1}`));
  http.request.mockResolvedValue(answer(hits));
  const { container } = mount(palette());
  type('shown');
  await screen.findByRole('button', { name: 'Shown 7' });
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(
    hits.map((item) => item.title),
  );
  // Nothing in the palette is a number: no "of N", no "showing N".
  const text = container.ownerDocument.body.textContent ?? '';
  expect(text.replace(/Shown \d/gu, '')).not.toMatch(/\d/u);
});
it('SEARCH-B08 Ctrl+K and the header control open the palette without changing the URL, and Esc closes it', async () => {
  http.request.mockResolvedValue(answer([]));
  const href = window.location.href;
  const user = { name: 'Reader', email: 'reader@example.test', role: 'member' };
  mount(<ShellHeader user={user} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('searchbox', { name: en.common.search })).toBeTruthy();
  expect(window.location.href).toBe(href);
  fireEvent.keyDown(within(dialog).getByRole('searchbox'), { key: 'Escape' });
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: en.common.searchWorkspace }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(window.location.href).toBe(href);
  // The chord is a modifier chord: a bare "k" opens nothing.
  fireEvent.keyDown(document, { key: 'Escape' });
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.keyDown(document, { key: 'k' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
