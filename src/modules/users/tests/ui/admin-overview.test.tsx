// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/core/i18n/messages/en.json';
import { AdminDataPage, AdminOverview } from '@/modules/users/ui';
import { attentionOf, readAi, readJobs, readMembers } from '@/modules/users/ui/admin-summary';

const data = vi.hoisted(() => ({
  users: [] as { role: string; isActive: boolean }[],
  admin: {} as Record<string, object>,
}));
vi.mock('@/modules/users/ui/queries', () => ({
  useUsers: () => ({ data: { data: data.users } }),
  useAdminResource: (path: string) =>
    path in data.admin
      ? { data: { data: data.admin[path] }, isPending: false, error: null }
      : { data: undefined, isPending: true, error: null },
  useAdminAction: () => ({ mutate: vi.fn(), isPending: false, error: null, isSuccess: false }),
}));
afterEach(() => {
  cleanup();
  data.users = [];
  data.admin = {};
});
const now = new Date().toISOString();
const healthy = () => {
  data.users = [
    { role: 'admin', isActive: true },
    { role: 'member', isActive: true },
    { role: 'admin', isActive: false },
  ];
  data.admin = {
    ai: { state: 'disabled', checkedAt: null, error: null },
    backups: [{ createdAt: now }],
    jobs: [{ status: 'succeeded', createdAt: now }],
    audit: [{ createdAt: now }],
  };
};
const mount = (node: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );

describe('ADMIN-B39 administration overview', () => {
  it('ADMIN-B39 raises failed jobs, a missing backup and a failed AI test, each linking to its page', () => {
    healthy();
    data.admin.backups = [];
    data.admin.jobs = [{ status: 'failed' }, { status: 'failed' }, { status: 'running' }];
    data.admin.ai = { state: 'error', checkedAt: now, error: 'network' };
    mount(<AdminOverview />);
    const attention = screen.getByRole('region', { name: en.admin.attentionTitle });
    expect(within(attention).getByText('2 jobs failed in the last 7 days.')).toBeTruthy();
    expect(within(attention).getByText(en.admin.attentionNoBackup)).toBeTruthy();
    expect(within(attention).getByText(en.admin.attentionAiFailed)).toBeTruthy();
    const href = (name: string) =>
      within(attention).getByRole('link', { name }).getAttribute('href');
    expect(href(en.admin.reviewJobs)).toBe('/admin/jobs');
    expect(href(en.admin.openBackups)).toBe('/admin/backups');
    expect(href(en.admin.openAi)).toBe('/admin/ai');
  });
  it('ADMIN-B39 ADMIN-B29 a workspace that never set AI up is not raised, and a healthy one says so', () => {
    healthy();
    mount(<AdminOverview />);
    expect(screen.queryByRole('region', { name: en.admin.attentionTitle })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(en.admin.attentionNone);
  });
  it('ADMIN-B39 ADMIN-B40 lists every administration page under its group with its current state', () => {
    healthy();
    mount(<AdminOverview />);
    const workspace = screen.getByRole('region', { name: en.admin.groupWorkspace });
    const members = within(workspace).getByRole('link', { name: /Members/ });
    expect(members.getAttribute('href')).toBe('/admin/users');
    // The inactive administrator is not counted: the line is about who can sign in.
    expect(members.textContent).toContain('2 active members, 1 administrator');
    const maintenance = screen.getByRole('region', { name: en.admin.groupMaintenance });
    expect(
      within(maintenance)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/admin/backups', '/admin/updates', '/admin/jobs', '/admin/audit']);
    expect(within(maintenance).getByText(en.admin.overviewJobsClear)).toBeTruthy();
    const content = screen.getByRole('region', { name: en.admin.groupContent });
    expect(
      within(content)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/admin/tasks', '/admin/notes', '/admin/objectives']);
    expect(within(workspace).getByRole('link', { name: /Email/ }).textContent).toContain(
      en.admin.overviewMail,
    );
    expect(screen.getAllByRole('link')).toHaveLength(11);
  });
  it('ADMIN-B39 says nothing about health until the lists it reads have arrived', () => {
    healthy();
    delete data.admin.jobs;
    mount(<AdminOverview />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('region', { name: en.admin.attentionTitle })).toBeNull();
  });
  it('ADMIN-B39 readings count only what an administrator can act on', () => {
    expect(readMembers([{ role: 'admin', isActive: false }])).toEqual({ active: 0, admins: 0 });
    expect(readAi({ state: 'disabled', checkedAt: now, error: null })).toBe('notConfigured');
    expect(readAi({ state: 'enabled', checkedAt: now, error: null })).toBe('connected');
    expect(readJobs([{ status: 'queued' }, { status: 'cancelled' }])).toEqual({
      failed: 0,
      active: 1,
    });
    expect(attentionOf({})).toEqual([]);
    expect(attentionOf({ lastBackupAt: null, ai: 'notTested' })).toEqual(['noBackup']);
  });
});

describe('ADMIN-B41 restore notice', () => {
  it('ADMIN-B41 the backups page says in-app restore is coming soon and shows no command', () => {
    data.admin.backups = [];
    mount(<AdminDataPage resource="backups" />);
    const restore = screen.getByRole('region', { name: en.admin.restoreTitle });
    expect(within(restore).getByText(en.admin.restoreSoon)).toBeTruthy();
    expect(within(restore).getByText(en.admin.restoreComingSoon)).toBeTruthy();
    expect(within(restore).queryByText(/backup:restore/)).toBeNull();
    expect(restore.querySelector('pre')).toBeNull();
  });
});
