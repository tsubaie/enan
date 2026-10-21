// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import { AccountSignIn } from '../../ui/AccountSignIn';
import { AccountSessions } from '../../ui/AccountSessions';
import { account, current, other, mutation, type Mutation } from './fixtures';
import { mount } from './harness';
const state = vi.hoisted(() => ({
  email: {} as Mutation,
  password: {} as Mutation,
  revoke: {} as Mutation,
  others: {} as Mutation,
}));
vi.mock('../../ui/queries', () => ({
  useAccount: () => ({ isPending: true, error: null }),
  usePatchAccount: () => mutation(),
  useChangeEmail: () => state.email,
  useChangePassword: () => state.password,
  useRevokeSession: () => state.revoke,
  useSignOutOthers: () => state.others,
}));
beforeEach(() => {
  state.email = mutation();
  state.password = mutation();
  state.revoke = mutation();
  state.others = mutation();
});
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
describe('ACCT-B01 ACCT-B06 the address is a form of its own', () => {
  it('ACCT-B01 ACCT-B06 the address submits as a form once it differs and the current password is given', () => {
    mount(<AccountSignIn account={account()} />);
    const input = screen.getByLabelText(en.account.email) as HTMLInputElement;
    expect(input.value).toBe('leila@example.test');
    expect(input.getAttribute('dir')).toBe('ltr');
    const save = button(en.common.save);
    expect(save.disabled).toBe(true);
    // Case alone is not a change: the server lowercases, so the stored address is what it would be.
    fireEvent.change(input, { target: { value: 'LEILA@example.test' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' Leila.New@example.test ' } });
    expect(save.disabled).toBe(true);
    // The email form's password field comes first; the password form below has its own.
    const [current] = screen.getAllByLabelText(en.account.currentPassword);
    fireEvent.change(current as HTMLInputElement, { target: { value: 'my password' } });
    expect(save.disabled).toBe(false);
    fireEvent.submit(save.closest('form') as HTMLFormElement);
    expect(state.email.mutate).toHaveBeenCalledWith(
      { revision: 3, email: 'Leila.New@example.test', current: 'my password' },
      expect.anything(),
    );
  });
  it('ACCT-B01 a taken address is reported beside the form', () => {
    state.email.error = new ApiError(
      'validation_failed',
      'Check the entered values.',
      { fieldErrors: { email: ['email_taken'] } },
      'req-3',
    );
    mount(<AccountSignIn account={account()} />);
    expect(screen.getByRole('alert').textContent).toContain('Check the entered values.');
  });
});
describe('ACCT-B02 ACCT-B06 the password is a form that asks for the current one', () => {
  const fill = (currentValue: string, nextValue: string) => {
    fireEvent.change(screen.getByLabelText(en.account.currentPassword), {
      target: { value: currentValue },
    });
    fireEvent.change(screen.getByLabelText(en.account.newPassword), {
      target: { value: nextValue },
    });
  };
  it('ACCT-B02 ACCT-B06 the submit wakes once both fields hold a usable value and sends both', () => {
    mount(<AccountSignIn account={account()} />);
    const change = button(en.account.changePassword);
    expect(change.disabled).toBe(true);
    expect(screen.getByText(en.account.passwordHint)).toBeTruthy();
    fill('', 'a brand new password');
    expect(change.disabled).toBe(true);
    fill('old password here', 'elevenchars');
    expect(change.disabled).toBe(true);
    fill('old password here', 'twelve chars');
    expect(change.disabled).toBe(false);
    fireEvent.submit(change.closest('form') as HTMLFormElement);
    expect(state.password.mutate).toHaveBeenCalledTimes(1);
    expect(state.password.mutate.mock.calls[0]?.[0]).toEqual({
      current: 'old password here',
      next: 'twelve chars',
    });
  });
  it('ACCT-B02 success says how many other devices were signed out, and the fields are emptied', () => {
    state.password.mutate = vi.fn((_input, options: { onSuccess: () => void }) =>
      options.onSuccess(),
    );
    mount(<AccountSignIn account={account()} />);
    fill('old password here', 'a brand new password');
    fireEvent.submit(button(en.account.changePassword).closest('form') as HTMLFormElement);
    expect((screen.getByLabelText(en.account.currentPassword) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(en.account.newPassword) as HTMLInputElement).value).toBe('');
    state.password = { ...mutation(), isSuccess: true, data: { data: { revoked: 2 } } };
    mount(<AccountSignIn account={account()} />);
    expect(screen.getByRole('status').textContent).toBe(
      'Password changed. 2 other sessions were signed out.',
    );
    state.password = { ...mutation(), isSuccess: true, data: { data: { revoked: 0 } } };
    mount(<AccountSignIn account={account()} />, 'ar');
    expect(screen.getByRole('status').textContent).toBe('تم تغيير كلمة المرور.');
  });
  it('ACCT-B02 ACCT-A02 a wrong current password is reported and nothing claims success', () => {
    state.password.error = new ApiError(
      'validation_failed',
      'Check the entered values.',
      { fieldErrors: { current: ['password_incorrect'] } },
      'req-4',
    );
    mount(<AccountSignIn account={account()} />);
    expect(screen.getByRole('alert').textContent).toContain('Check the entered values.');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
describe.each(['en', 'ar'] as const)('ACCT-B03 sessions %s', (locale) => {
  const m = locale === 'ar' ? ar : en;
  it(`ACCT-B03 this device is marked and cannot be revoked here; every other one can ${locale}`, () => {
    mount(<AccountSessions account={account()} />, locale);
    const rows = screen.getAllByText(/Mozilla/u).map((agent) => agent.parentElement as HTMLElement);
    expect(rows).toHaveLength(2);
    const [mine, theirs] = rows as [HTMLElement, HTMLElement];
    expect(within(mine).getByText(m.account.currentSession)).toBeTruthy();
    expect(within(mine).queryByRole('button', { name: m.account.revoke })).toBeNull();
    expect(within(theirs).queryByText(m.account.currentSession)).toBeNull();
    // The user agent is an opaque identifier: never translated, always left to right.
    const agent = within(theirs).getByText(other.userAgent);
    expect(agent.getAttribute('dir')).toBe('ltr');
    expect(agent.getAttribute('translate')).toBe('no');
    expect(
      within(theirs).getByText(m.account.lastSeen, { exact: false }).getAttribute('title'),
    ).toBe(other.lastSeenAt);
    fireEvent.click(within(theirs).getByRole('button', { name: m.account.revoke }));
    expect(state.revoke.mutate).toHaveBeenCalledWith(other.id);
    expect(state.revoke.mutate).not.toHaveBeenCalledWith(current.id);
  });
  it(`ACCT-B03 "sign out everywhere else" confirms, names what stays, and only then revokes ${locale}`, () => {
    mount(<AccountSessions account={account()} />, locale);
    fireEvent.click(screen.getByRole('button', { name: m.account.signOutOthers }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(m.account.signOutOthersConfirm)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: m.common.cancel }));
    expect(state.others.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: m.account.signOutOthers }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: m.common.confirm }),
    );
    expect(state.others.mutate).toHaveBeenCalledTimes(1);
  });
});
it('ACCT-B03 with no other device there is nothing to sign out and the page says so', () => {
  mount(<AccountSessions account={account({ sessions: [current] })} />);
  expect(screen.getByText(en.account.noOtherSessions)).toBeTruthy();
  expect(screen.queryByRole('button', { name: en.account.signOutOthers })).toBeNull();
  expect(screen.queryByRole('button', { name: en.account.revoke })).toBeNull();
});
it('ACCT-B03 a device with no user agent is named by its address, and one with neither is called unrecognised', () => {
  mount(
    <AccountSessions
      account={account({
        sessions: [
          current,
          { ...other, userAgent: null },
          { ...other, id: '01a08a9f-1991-760a-b73a-568f6f866503', userAgent: null, ip: null },
        ],
      })}
    />,
  );
  expect(screen.getByText(other.ip)).toBeTruthy();
  expect(screen.getByText(en.account.unknownDevice)).toBeTruthy();
});
it('ACCT-B03 a failed revocation is reported on the page', () => {
  state.revoke.error = new ApiError(
    'not_found',
    'The requested record was not found.',
    null,
    'req-5',
  );
  mount(<AccountSessions account={account()} />);
  expect(screen.getByRole('alert').textContent).toContain('The requested record was not found.');
});
