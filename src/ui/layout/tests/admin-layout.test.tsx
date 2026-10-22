// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import { AdminLayout } from '@/ui/layout/AdminLayout';
import { adminPageOf } from '@/ui/layout/admin-sections';

const path = vi.hoisted(() => ({ value: '/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.value }));
afterEach(cleanup);
const mount = (at: string) => {
  path.value = at;
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AdminLayout>
        <p />
      </AdminLayout>
    </NextIntlClientProvider>,
  );
};
const nav = () => screen.getByRole('navigation', { name: en.common.admin, hidden: true });

it('ADMIN-B40 the side list groups every administration page and marks the one shown', () => {
  mount('/admin/backups');
  const groups = within(nav())
    .getAllByRole('list', { hidden: true })
    .map((list) => list.getAttribute('aria-labelledby'));
  expect(groups).toEqual([
    'admin-nav-groupWorkspace',
    'admin-nav-groupContent',
    'admin-nav-groupMaintenance',
  ]);
  const links = within(nav()).getAllByRole('link', { hidden: true });
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/admin',
    '/admin/settings',
    '/admin/ai',
    '/admin/users',
    '/admin/signin',
    '/admin/mail',
    '/admin/tasks',
    '/admin/notes',
    '/admin/objectives',
    '/admin/backups',
    '/admin/updates',
    '/admin/jobs',
    '/admin/audit',
  ]);
  const current = links.filter((link) => link.getAttribute('aria-current') === 'page');
  expect(current.map((link) => link.textContent)).toEqual([en.admin.backups]);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.admin.backups);
});
it('ADMIN-B40 a page links back to the overview, which needs no way back to itself', () => {
  mount('/admin/jobs');
  const back = screen
    .getAllByRole('link', { name: en.common.admin })
    .filter((link) => !nav().contains(link));
  expect(back.map((link) => link.getAttribute('href'))).toEqual(['/admin']);
  cleanup();
  mount('/admin');
  expect(
    screen
      .queryAllByRole('link', { name: en.common.admin })
      .filter((link) => !nav().contains(link)),
  ).toEqual([]);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.common.admin);
});
it('ADMIN-B40 only a known administration page is treated as one', () => {
  expect(adminPageOf('/admin')).toBeNull();
  expect(adminPageOf('/admin/audit')).toBe('audit');
  expect(adminPageOf('/admin/unknown')).toBeNull();
});
