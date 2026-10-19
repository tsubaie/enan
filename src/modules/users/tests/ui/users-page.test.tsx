// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import { UsersPage } from '../../ui/UsersPage';
import { mount } from './harness';
const admin = {
  id: '01a08a9f-1991-760a-b73a-568f6f866500',
  email: 'admin@example.test',
  name: 'Workspace Administrator',
  role: 'admin' as const,
  isActive: true,
  revision: 4,
};
const member = {
  id: '01a08a9f-1991-760a-b73a-568f6f866501',
  email: 'dana@example.test',
  name: 'Dana Example',
  role: 'member' as const,
  isActive: false,
  revision: 2,
};
type Mutation = {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: Error | null;
  data: object | undefined;
};
const state = vi.hoisted(() => {
  const mutation = (): Mutation => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
  });
  return {
    query: { isPending: false, error: null as Error | null, data: { data: [] as object[] } },
    create: mutation(),
    update: mutation(),
    reset() {
      state.query = { isPending: false, error: null, data: { data: [] } };
      state.create = mutation();
      state.update = mutation();
    },
  };
});
vi.mock('../../ui/queries', () => ({
  useUsers: () => state.query,
  useCreateUser: () => state.create,
  useUpdateUser: () => state.update,
}));
beforeEach(() => state.reset());
const dialog = () => screen.getByRole('dialog');
it('ADMIN-B03 the member list shows each account with its role and activity, in both locales', () => {
  state.query.data = { data: [admin, member] };
  mount(<UsersPage />);
  expect(screen.getByText(admin.name)).toBeTruthy();
  expect(screen.getByText(member.email)).toBeTruthy();
  expect(screen.getByText(`${en.admin.admin} · ${en.common.active}`)).toBeTruthy();
  expect(screen.getByText(`${en.admin.member} · ${en.common.inactive}`)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: en.common.edit })).toHaveLength(2);
  mount(<UsersPage />, 'ar');
  expect(screen.getByText(`${ar.admin.member} · ${ar.common.inactive}`)).toBeTruthy();
  expect(screen.getByRole('button', { name: ar.admin.addUser })).toBeTruthy();
});
it('ADMIN-B03 inviting a member sends name, email and role and then shows the temporary password once', async () => {
  mount(<UsersPage />);
  fireEvent.click(screen.getByRole('button', { name: en.admin.addUser }));
  const form = within(dialog());
  fireEvent.change(form.getByLabelText(en.admin.name), { target: { value: 'New Member' } });
  fireEvent.change(form.getByLabelText(en.auth.email), { target: { value: 'New@Example.test' } });
  fireEvent.change(form.getByLabelText(en.admin.role), { target: { value: 'admin' } });
  fireEvent.submit(form.getByRole('button', { name: en.admin.addUser }));
  await waitFor(() => expect(state.create.mutate).toHaveBeenCalledTimes(1));
  expect(state.create.mutate).toHaveBeenCalledWith({
    name: 'New Member',
    email: 'new@example.test',
    role: 'admin',
  });
  // The response is the only time the password is shown; the form is gone.
  state.create.data = {
    data: { ...member, name: 'New Member' },
    meta: { temporaryPassword: 'fixture one-time pass' },
  };
  mount(<UsersPage />);
  fireEvent.click(screen.getByRole('button', { name: en.admin.addUser }));
  expect(within(dialog()).getByText(en.admin.temporaryPassword)).toBeTruthy();
  expect(within(dialog()).getByText('fixture one-time pass').getAttribute('dir')).toBe('ltr');
  expect(within(dialog()).queryByLabelText(en.auth.email)).toBeNull();
});
it('ADMIN-B03 an invalid invitation is held on the client and only a corrected one is sent', async () => {
  mount(<UsersPage />);
  fireEvent.click(screen.getByRole('button', { name: en.admin.addUser }));
  const form = within(dialog());
  fireEvent.change(form.getByLabelText(en.admin.name), { target: { value: 'No Email' } });
  fireEvent.change(form.getByLabelText(en.auth.email), { target: { value: 'not-an-email' } });
  fireEvent.submit(form.getByRole('button', { name: en.admin.addUser }));
  fireEvent.change(form.getByLabelText(en.auth.email), { target: { value: 'fixed@example.test' } });
  fireEvent.submit(form.getByRole('button', { name: en.admin.addUser }));
  await waitFor(() => expect(state.create.mutate).toHaveBeenCalledTimes(1));
  expect(state.create.mutate).toHaveBeenCalledWith({
    name: 'No Email',
    email: 'fixed@example.test',
    role: 'member',
  });
});
it('ADMIN-B03 editing sends the new name, role and activity against the revision the row was read at', () => {
  state.query.data = { data: [admin, member] };
  mount(<UsersPage />);
  fireEvent.click(screen.getAllByRole('button', { name: en.common.edit })[1] as Element);
  const form = within(dialog());
  fireEvent.change(form.getByLabelText(en.admin.name), { target: { value: 'Dana Renamed' } });
  fireEvent.change(form.getByLabelText(en.admin.role), { target: { value: 'admin' } });
  // The activity button shows the current state and flips it.
  fireEvent.click(form.getByRole('button', { name: en.common.inactive }));
  expect(form.getByRole('button', { name: en.common.active })).toBeTruthy();
  fireEvent.click(form.getByRole('button', { name: en.common.save }));
  expect(state.update.mutate).toHaveBeenCalledWith({
    id: member.id,
    input: { name: 'Dana Renamed', role: 'admin', isActive: true, revision: member.revision },
  });
});
it('ADMIN-A02 ADMIN-B04 a refused last-admin change is shown as an alert and the saved state is not claimed', () => {
  state.query.data = { data: [admin] };
  state.update.isError = true;
  state.update.error = new ApiError(
    'rule_violation',
    en.errors.rule_violation,
    { rule: 'ADMIN-B04' },
    'req-1',
  );
  mount(<UsersPage />);
  fireEvent.click(screen.getByRole('button', { name: en.common.edit }));
  const form = within(dialog());
  expect(form.getByRole('alert').textContent).toContain(en.errors.rule_violation);
  expect(form.queryByText(en.common.saved)).toBeNull();
  state.update.isError = false;
  state.update.error = null;
  state.update.isSuccess = true;
  mount(<UsersPage />);
  fireEvent.click(screen.getByRole('button', { name: en.common.edit }));
  expect(within(dialog()).getByRole('status').textContent).toBe(en.common.saved);
});
it('ADMIN-B03 a failed list shows the error instead of an empty roster', () => {
  state.query.error = new ApiError('forbidden', en.errors.forbidden, { reason: 'role' }, 'req-2');
  mount(<UsersPage />);
  expect(screen.getByRole('alert').textContent).toContain(en.errors.forbidden);
  expect(screen.queryByRole('list')).toBeNull();
});
