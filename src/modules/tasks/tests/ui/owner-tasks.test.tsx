// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { request } from '@/core/http/client';
import { OwnerTasks } from '../../ui/OwnerTasks';
import { mount } from './harness';
vi.mock('@/core/http/client', () => ({ request: vi.fn() }));
const personId = '01a0a000-0000-7000-8000-000000000001';
const task = (n: number, title: string) => ({
  id: `01a0a000-0000-7000-8000-00000000001${n}`,
  title,
  revision: 1,
});
beforeEach(() => {
  vi.mocked(request).mockResolvedValue({
    data: [task(1, 'Approve the budget'), task(2, 'Sign the minutes'), task(3, 'Call the auditor')],
    meta: { counts: { all: 3 }, nextCursor: null, defaultView: 'next' },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe.each(['en', 'ar'] as const)('owner context tab (%s)', (locale) => {
  const t = locale === 'ar' ? ar : en;
  it("TASKS-A08 TASKS-B10 a person's Context tab asks for the tasks they own and links each one into the owner-filtered list", async () => {
    mount(<OwnerTasks personId={personId} />, locale);
    expect(screen.getByRole('heading', { name: t.tasks.assignedTasks })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Approve the budget')).toBeTruthy());
    // The request is the owner facet, every view, nothing else narrowing it.
    const [path] = vi.mocked(request).mock.calls[0] ?? [];
    const params = new URLSearchParams(String(path).split('?')[1]);
    expect(String(path).startsWith('/tasks?')).toBe(true);
    expect(params.get('ownerId')).toBe(personId);
    expect(params.get('view')).toBe('all');
    expect(params.get('q')).toBeNull();
    // Each row opens the task inside that same owner-filtered list, and the footer link carries
    // the count the API reported for the facet.
    const row = screen.getByRole('link', { name: 'Sign the minutes' });
    expect(row.getAttribute('href')).toContain(`ownerId=${personId}`);
    expect(row.getAttribute('href')).toContain(task(2, '').id);
    const footer = screen.getByRole('link', {
      name: t.tasks.viewAssigned.replace(/\{count[^}]*\}/u, '3'),
    });
    expect(footer.getAttribute('href')).toContain(`ownerId=${personId}`);
  });
});
it("TASKS-A08 the tab shows at most five of the owner's tasks and reports the full count beside them", async () => {
  vi.mocked(request).mockResolvedValue({
    data: Array.from({ length: 7 }, (_, index) => task(index, `Task ${index}`)),
    meta: { counts: { all: 7 }, nextCursor: null, defaultView: 'next' },
  });
  mount(<OwnerTasks personId={personId} />);
  await waitFor(() => expect(screen.getByText('Task 0')).toBeTruthy());
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
  expect(screen.queryByText('Task 5')).toBeNull();
  expect(
    screen.getByRole('link', { name: en.tasks.viewAssigned.replace(/\{count[^}]*\}/u, '7') }),
  ).toBeTruthy();
});
