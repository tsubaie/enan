// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
// The person page shows the notes module's own section; the list it reads is the API's answer,
// so the hook is what a scenario controls (UI layer: mocked API, docs/08 § Layers).
const feed = vi.hoisted(() => ({
  items: [] as { id: string; title: string }[],
  counts: {} as Record<string, number>,
  filters: null as object | null,
}));
vi.mock('@/modules/notes/ui/queries', () => ({
  useNotes: (filters: object) => {
    feed.filters = filters;
    return {
      items: feed.items,
      counts: feed.counts,
      pending: false,
      error: null,
      more: false,
      fetchMore: async () => undefined,
      refetch: () => undefined,
    };
  },
}));
const { PersonNotes } = await import('@/modules/notes/ui/PersonNotes');
const personId = '01a0a000-0000-7000-8000-000000000001';
afterEach(cleanup);
function mount(count: number, locale: 'en' | 'ar' = 'en') {
  feed.items = Array.from({ length: count }, (_, index) => ({
    id: `01a0a000-0000-7000-8000-0000000000${String(index + 10)}`,
    title: `Note ${index + 1}`,
  }));
  feed.counts = { all: count };
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'ar' ? ar : en}
      formats={{ number: { integer: { maximumFractionDigits: 0 } } }}
    >
      <PersonNotes personId={personId} />
    </NextIntlClientProvider>,
  );
}
it('NOTES-B15 PEOPLE-B03 the person page shows the latest five notes the person took part in', () => {
  mount(7);
  expect(feed.filters).toMatchObject({ personId, view: 'all' });
  expect(screen.getByRole('heading', { name: en.notes.personNotes })).toBeTruthy();
  const notes = screen
    .getAllByRole('link')
    .filter((link) => /^Note \d$/u.test(link.textContent ?? ''));
  expect(notes.map((link) => link.textContent)).toEqual([
    'Note 1',
    'Note 2',
    'Note 3',
    'Note 4',
    'Note 5',
  ]);
  // Each note opens inside the person's filtered list, so the way back keeps the person.
  expect(notes[0]?.getAttribute('href')).toBe(
    `/notes?view=all&personId=${personId}&id=${feed.items[0]?.id}`,
  );
});
it('NOTES-B15 the link to the full list carries the person and the whole count', () => {
  mount(7);
  const more = screen.getByRole('link', { name: en.notes.viewNotes.replace(/\{count[^}]*\}/u, '7') });
  expect(more.getAttribute('href')).toBe(`/notes?view=all&personId=${personId}`);
  cleanup();
  mount(0, 'ar');
  expect(
    screen.getByRole('link', { name: ar.notes.viewNotes.replace(/\{count[^}]*\}/u, '0') }),
  ).toBeTruthy();
  expect(screen.queryAllByRole('link')).toHaveLength(1);
});
