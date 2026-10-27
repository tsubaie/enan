// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import type { Notification } from '../../schema/validation';
import { NotificationsPage } from '../../ui/NotificationsPage';
import { mount } from './harness';
// The page reads its filters from the address and the feed through the one HTTP client; both are
// stood in for, so a scenario can set the address and see what was asked of the API.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  request: vi.fn(),
  search: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.search,
}));
vi.mock('@/core/http/client', () => ({ request: mocks.request }));
afterEach(() => {
  cleanup();
  mocks.request.mockReset();
});
const line = (index: number, readAt: string | null = null): Notification => ({
  id: `01a08a9f-1991-760a-b73a-568f6f8665${String(10 + index).padStart(2, '0')}`,
  kind: 'task.assigned',
  subjectType: 'tasks',
  subjectId: '01a08a9f-1991-760a-b73a-568f6f866501',
  title: `Item ${index}`,
  href: '/tasks',
  actorName: 'Assigning Actor',
  createdAt: new Date(Date.UTC(2026, 8, 10, 20, index)).toISOString(),
  readAt,
});
function serve(items: Notification[]) {
  mocks.request.mockImplementation(async (path: string) =>
    path === '/notifications/read-all'
      ? { data: { marked: 1 } }
      : { data: { items, unread: items.length, totalCount: items.length, nextCursor: null } },
  );
}
const at = (search: string) => {
  mocks.search = new URLSearchParams(search);
};
it('NOTIF-B14 NOTIF-B16 the address filters ask the server for the newest hundred that match', async () => {
  at('unread=1&kind=tasks');
  serve([line(0)]);
  mount(<NotificationsPage />);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      '/notifications?limit=100&unread=1&kind=tasks',
      expect.anything(),
    ),
  );
  expect(screen.getByRole('button', { name: en.notifications.showUnread }).ariaPressed).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: en.notifications.showAll }));
  expect(window.location.search).toBe('?kind=tasks');
});
it('NOTIF-B07 NOTIF-B16 mark all on the page marks the filtered kind and each row says when', async () => {
  at('kind=notes');
  serve([line(0)]);
  mount(<NotificationsPage />);
  await screen.findByText(/Item 0\b/u);
  fireEvent.click(screen.getByRole('button', { name: en.notifications.markAllRead }));
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('/notifications/read-all', expect.anything(), {
      method: 'POST',
      body: { kind: 'notes' },
    }),
  );
  expect(document.querySelector('time')?.textContent).toContain(' · ');
});
it('NOTIF-B16 EP-B47 the page shows twenty with the next row fading beneath', async () => {
  at('');
  serve(Array.from({ length: 25 }, (_, index) => line(index, '2026-09-11T08:00:00.000Z')));
  mount(<NotificationsPage />);
  await screen.findByText(/Item 0\b/u);
  expect(document.querySelectorAll('time')).toHaveLength(21);
  expect(document.querySelector('[inert] time')).toBeTruthy();
  // Everything shown is read, so there is nothing to mark.
  expect(
    (screen.getByRole('button', { name: en.notifications.markAllRead }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
it('NOTIF-B12 the empty page says nothing has arrived for All and caught up for Unread, in both locales', async () => {
  at('');
  serve([]);
  mount(<NotificationsPage />);
  expect(await screen.findByText(en.notifications.empty)).toBeTruthy();
  cleanup();
  at('unread=1');
  mount(<NotificationsPage />, 'ar');
  expect(await screen.findByText(ar.notifications.caughtUp)).toBeTruthy();
});
