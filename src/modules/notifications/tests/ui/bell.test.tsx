// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import type { Notification } from '../../schema/validation';
import { NotificationBell } from '../../ui/NotificationBell';
import { mount, plural } from './harness';
// The bell is read through the one HTTP client and leaves through the router; both are stood in
// for here so a scenario can say what the API answered and see where the reader was sent.
const mocks = vi.hoisted(() => ({ push: vi.fn(), request: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/core/http/client', () => ({ request: mocks.request }));
vi.mock('@tanstack/react-query', async (original) => {
  const actual = await original<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: vi.fn(actual.useQuery) };
});
afterEach(cleanup);
const line = (overrides: Partial<Notification> = {}): Notification => ({
  id: '01a08a9f-1991-760a-b73a-568f6f866500',
  kind: 'task.assigned',
  subjectType: 'tasks',
  subjectId: '01a08a9f-1991-760a-b73a-568f6f866501',
  title: 'Review the board pack',
  href: '/tasks?id=01a08a9f-1991-760a-b73a-568f6f866501',
  actorName: 'Assigning Actor',
  createdAt: '2026-09-10T08:00:00.000Z',
  readAt: null,
  ...overrides,
});
function serve(
  items: Notification[],
  unread = items.filter((item) => !item.readAt).length,
  totalCount = items.length,
) {
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/notifications?limit=10')
      return { data: { items, unread, totalCount, nextCursor: null } };
    if (path.endsWith('/read')) return { data: { id: path.split('/')[2] } };
    if (path === '/notifications/read-all') return { data: { marked: unread } };
    throw new Error(`unexpected request ${path}`);
  });
}
const writes = () =>
  mocks.request.mock.calls
    .filter(([, , options]) => (options as { method?: string } | undefined)?.method === 'POST')
    .map(([path]) => path as string);
const sentence = (messages: typeof en, item: Notification) =>
  messages.notifications.taskAssigned
    .replace('{actor}', item.actorName ?? messages.notifications.someone)
    .replace('{title}', item.title);
const popover = () => document.querySelector('[data-slot="popover-content"]');
it('NOTIF-B08 NOTIF-A01 the bell shows the unread count and says it in its name', async () => {
  serve([line(), line({ id: '01a08a9f-1991-760a-b73a-568f6f866502' })], 2);
  mount(<NotificationBell />);
  const bell = await screen.findByRole('button', {
    name: plural(en.notifications.unread, 'other', 2),
  });
  expect(within(bell).getByText('2').className).toContain('tabular-nums');
});
it('NOTIF-B08 the badge is absent at zero and reads 99+ past ninety-nine', async () => {
  serve([], 0);
  mount(<NotificationBell />);
  const quiet = await screen.findByRole('button', { name: en.notifications.title });
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  expect(within(quiet).queryByText('0')).toBeNull();
  expect(quiet.textContent).toBe('');
  serve([line()], 120);
  mount(<NotificationBell />);
  await screen.findByText('99+');
  expect(screen.queryByText('120')).toBeNull();
});
it('NOTIF-A01 NOTIF-B07 opening the centre lists the row naming the actor and the task and marks nothing read', async () => {
  const item = line();
  serve([item]);
  mount(<NotificationBell />);
  fireEvent.click(
    await screen.findByRole('button', { name: plural(en.notifications.unread, 'one') }),
  );
  expect(await screen.findByText(sentence(en, item))).toBeTruthy();
  expect(screen.getByRole('heading', { name: en.notifications.title })).toBeTruthy();
  expect(screen.getByRole('button', { name: en.notifications.markAllRead })).toBeTruthy();
  expect(writes()).toEqual([]);
  expect(mocks.push).not.toHaveBeenCalled();
});
it('NOTIF-A01 the Arabic row orders the actor and the record its own way', async () => {
  const item = line({ actorName: 'سارة' });
  serve([item]);
  mount(<NotificationBell />, 'ar');
  fireEvent.click(
    await screen.findByRole('button', { name: plural(ar.notifications.unread, 'one') }),
  );
  const row = await screen.findByText(sentence(ar, item));
  expect(row.getAttribute('dir')).toBe('auto');
  expect(screen.getByRole('heading', { name: ar.notifications.title })).toBeTruthy();
});
it('NOTIF-B09 NOTIF-A03 opening a row marks it read, goes to its subject and closes the centre', async () => {
  const item = line();
  serve([item]);
  mount(<NotificationBell />);
  fireEvent.click(
    await screen.findByRole('button', { name: plural(en.notifications.unread, 'one') }),
  );
  fireEvent.click(await screen.findByText(sentence(en, item)));
  await waitFor(() => expect(writes()).toEqual([`/notifications/${item.id}/read`]));
  expect(mocks.push).toHaveBeenCalledWith(item.href);
  await waitFor(() => expect(popover()).toBeNull());
});
it('NOTIF-B09 NOTIF-B07 a row already read is only opened, never marked again', async () => {
  const item = line({ readAt: '2026-09-10T08:30:00.000Z' });
  serve([item]);
  mount(<NotificationBell />);
  fireEvent.click(await screen.findByRole('button', { name: en.notifications.title }));
  // Nothing is unread, so the header offers no "Mark all as read" either.
  expect(await screen.findByText(sentence(en, item))).toBeTruthy();
  expect(screen.queryByRole('button', { name: en.notifications.markAllRead })).toBeNull();
  fireEvent.click(screen.getByText(sentence(en, item)));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(item.href));
  expect(writes()).toEqual([]);
});
it('NOTIF-B08 NOTIF-B07 the header counts the unread and each row reads bold until opened, with a relative time', async () => {
  const unread = line();
  const seen = line({
    id: '01a08a9f-1991-760a-b73a-568f6f866502',
    actorName: 'Seen Actor',
    readAt: '2026-09-10T08:30:00.000Z',
  });
  serve([unread, seen]);
  mount(<NotificationBell />);
  fireEvent.click(
    await screen.findByRole('button', { name: plural(en.notifications.unread, 'one') }),
  );
  await screen.findByText(sentence(en, unread));
  const content = popover() as HTMLElement;
  const pill = within(content).getByText('1');
  expect(pill.className).toContain('tabular-nums');
  expect(pill.className).toContain('bg-accent-soft');
  expect(screen.getByText(sentence(en, unread)).className).toContain('font-medium');
  expect(screen.getByText(sentence(en, seen)).className).toContain('font-normal');
  expect(screen.getByText(sentence(en, seen)).className).not.toContain('font-medium');
  const times = content.querySelectorAll('time');
  expect([...times].map((time) => time.dateTime)).toEqual([unread.createdAt, seen.createdAt]);
  // The relative wording is in the row; the absolute moment rides in the title.
  for (const time of times) {
    expect(time.title).toBeTruthy();
    expect(time.title).not.toBe(time.textContent);
  }
});
it('NOTIF-B07 mark all as read is one write for the whole feed', async () => {
  serve([line()]);
  mount(<NotificationBell />);
  fireEvent.click(
    await screen.findByRole('button', { name: plural(en.notifications.unread, 'one') }),
  );
  fireEvent.click(await screen.findByRole('button', { name: en.notifications.markAllRead }));
  await waitFor(() => expect(writes()).toEqual(['/notifications/read-all']));
});
it('NOTIF-B12 the empty centre says nothing has arrived and offers nothing', async () => {
  serve([], 0);
  mount(<NotificationBell />);
  fireEvent.click(await screen.findByRole('button', { name: en.notifications.title }));
  expect(await screen.findByText(en.notifications.empty)).toBeTruthy();
  const content = popover();
  if (!content) throw new Error('centre not open');
  expect(within(content as HTMLElement).queryAllByRole('button')).toHaveLength(0);
  expect(within(content as HTMLElement).queryAllByRole('link')).toHaveLength(0);
  expect(screen.queryByText(en.notifications.loading)).toBeNull();
});
it('NOTIF-B12 the Arabic empty centre names the purpose in Arabic', async () => {
  serve([], 0);
  mount(<NotificationBell />, 'ar');
  fireEvent.click(await screen.findByRole('button', { name: ar.notifications.title }));
  expect(await screen.findByText(ar.notifications.empty)).toBeTruthy();
});
it('NOTIF-B11 the feed refetches on window focus and every sixty seconds, with no socket', async () => {
  serve([]);
  mount(<NotificationBell />);
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith('/notifications?limit=10', expect.anything()),
  );
  type Options = {
    refetchOnWindowFocus?: boolean;
    refetchInterval?: number;
    queryKey?: readonly string[];
  };
  const options = vi
    .mocked(useQuery)
    .mock.calls.map(([query]) => query as Options)
    .find((query) => query.queryKey?.slice(0, 2).join() === 'notifications,list');
  expect(options).toMatchObject({ refetchOnWindowFocus: true, refetchInterval: 60_000 });
});
const tenOf = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    line({
      id: `01a08a9f-1991-760a-b73a-568f6f8665${String(10 + index)}`,
      title: `Item ${index}`,
      createdAt: new Date(Date.UTC(2026, 8, 10, 20 - index)).toISOString(),
      readAt: index % 2 ? null : '2026-09-11T08:00:00.000Z',
    }),
  );
it('NOTIF-B15 the bell previews ten, unread first, newest first within each, and links to the page with the total', async () => {
  // The server answers the newest ten of eleven; the eleventh is only in the total.
  serve(tenOf(10), 11, 11);
  mount(<NotificationBell />);
  fireEvent.click(await screen.findByRole('button', { name: /Notifications/u }));
  // The house link-as-button (as in the avatar menu) is an anchor that announces as a button.
  const link = (
    await screen.findByText(en.notifications.seeAllCount.replace('{count, number, integer}', '11'))
  ).closest('a');
  if (!link) throw new Error('no link');
  expect(link.getAttribute('href')).toBe('/notifications');
  const content = popover() as HTMLElement;
  const titles = [...content.querySelectorAll('[dir="auto"]')].map(
    (row) => /Item (\d+)/u.exec(row.textContent ?? '')?.[1],
  );
  expect(titles).toEqual(['1', '3', '5', '7', '9', '0', '2', '4', '6', '8']);
  // Fixed height: the preview does not scroll inside itself.
  expect(content.querySelector('.overflow-y-auto')).toBeNull();
  fireEvent.click(link);
  await waitFor(() => expect(popover()).toBeNull());
});
it('NOTIF-B15 with ten or fewer the link names no count, and mark all is one write for every row', async () => {
  serve(tenOf(3));
  mount(<NotificationBell />, 'ar');
  fireEvent.click(await screen.findByRole('button', { name: /الإشعارات/u }));
  expect(
    (await screen.findByText(ar.notifications.seeAll)).closest('a')?.getAttribute('href'),
  ).toBe('/notifications');
  fireEvent.click(screen.getByRole('button', { name: ar.notifications.markAllRead }));
  await waitFor(() => expect(writes()).toEqual(['/notifications/read-all']));
  const [, , options] =
    mocks.request.mock.calls.find(([path]) => path === '/notifications/read-all') ?? [];
  expect((options as { body?: object }).body).toEqual({});
});
