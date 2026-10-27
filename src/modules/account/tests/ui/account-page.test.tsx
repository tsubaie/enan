// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import type { Account } from '../../schema/validation';
import { AccountPage } from '../../ui/AccountPage';
import { AccountIdentity } from '../../ui/AccountIdentity';
import { AccountPreferences } from '../../ui/AccountPreferences';
import { account, current, mutation, other, person } from './fixtures';
import { mount } from './harness';
// The page is exercised without its network layer: the query hooks are the only seam, so each
// scenario hands the account in and watches what the controls ask to write.
const state = vi.hoisted(() => ({
  query: {} as { isPending: boolean; error: Error | null; data?: { data: Account } },
  patch: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  add: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as Error | null },
  remove: { mutate: vi.fn(), isPending: false, error: null as Error | null },
}));
vi.mock('../../ui/queries', () => ({
  useAccount: () => state.query,
  usePatchAccount: () => state.patch,
  useChangeEmail: () => mutation(),
  useChangePassword: () => mutation(),
  useRevokeSession: () => mutation(),
  useSignOutOthers: () => mutation(),
  useAddPasskey: () => state.add,
  useRemovePasskey: () => state.remove,
}));
beforeEach(() => {
  state.patch = { mutate: vi.fn(), isPending: false, error: null };
  state.add = { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null };
  state.remove = { mutate: vi.fn(), isPending: false, error: null };
  state.query = { isPending: false, error: null, data: { data: account() } };
});
const messages = { en, ar };
describe.each(['en', 'ar'] as const)('%s', (locale) => {
  const m = messages[locale];
  it(`ACCT-B08 ACCT-B07 the page is one record in four sections and sends workspace settings to Administration ${locale}`, () => {
    mount(<AccountPage />, locale);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Leila Haddad');
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([m.account.identity, m.account.signIn, m.account.sessions, m.account.preferences]);
    // Nothing here deletes or deactivates the account; the one way out is the link to the place
    // that owns everyone's settings.
    expect(screen.getByText(m.account.workspaceElsewhere, { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: m.common.admin }).getAttribute('href')).toBe(
      '/admin/settings',
    );
  });
  it(`ACCT-B05 ACCT-A05 the linked person is a link to the directory, and its absence is explained ${locale}`, () => {
    mount(<AccountIdentity account={account()} />, locale);
    const link = screen.getByRole('link', { name: person.fullName });
    expect(link.getAttribute('href')).toBe(`/people?id=${person.id}`);
    expect(screen.getByText(m.account.linkedPerson)).toBeTruthy();
    expect(screen.queryByText(m.account.noLinkedPerson)).toBeNull();
    mount(<AccountIdentity account={account({ person: null })} />, locale);
    expect(screen.getByText(m.account.noLinkedPerson)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
it('ACCT-B08 the page waits on its query and reports a failed one instead of rendering a blank record', () => {
  state.query = { isPending: true, error: null };
  mount(<AccountPage />);
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  state.query = { isPending: false, error: new ApiError('not_found', 'Gone', null, 'req-1') };
  mount(<AccountPage />);
  expect(screen.getByRole('alert').textContent).toContain('Gone');
});
it('ACCT-B03 a long user agent truncates inside its row instead of widening the sessions list', () => {
  const userAgent =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.3912.160 Vivaldi/7.6.3797.52';
  expect(userAgent).toHaveLength(140);
  state.query.data = {
    data: account({
      sessions: [
        { ...current, userAgent },
        { ...other, userAgent },
      ],
    }),
  };
  mount(<AccountPage />);
  const [agent] = screen.getAllByText(userAgent);
  const row = agent?.parentElement;
  expect(agent?.classList).toContain('truncate');
  expect(agent?.classList).toContain('min-w-0');
  expect(row?.classList).toContain('min-w-0');
  expect(row?.parentElement?.classList).toContain('min-w-0');
});
it('ACCT-B01 ACCT-B06 the name saves through an explicit action that wakes only for a real change', () => {
  mount(<AccountIdentity account={account()} />);
  const input = screen.getByLabelText(en.account.name) as HTMLInputElement;
  const save = screen.getByRole('button', { name: en.common.save });
  expect(input.value).toBe('Leila Haddad');
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: '   ' } });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: ' Leila Haddad ' } });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: '  Leila H. ' } });
  expect((save as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(save);
  expect(state.patch.mutate).toHaveBeenCalledWith({ revision: 3, name: 'Leila H.' });
});
it('ACCT-B01 a rejected rename is shown beside the field and the control waits while one is in flight', () => {
  state.patch.error = new ApiError('conflict', 'The record changed.', { expected: 4 }, 'req-9');
  mount(<AccountIdentity account={account()} />);
  expect(screen.getByRole('alert').textContent).toContain('The record changed.');
  state.patch = { mutate: vi.fn(), isPending: true, error: null };
  mount(<AccountIdentity account={account()} />);
  const saving = screen.getByRole('button', { name: en.common.saving }) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
});
describe('ACCT-B04 ACCT-I03 each preference is a choice between its values and following the workspace', () => {
  const combo = (label: string) => screen.getByRole('combobox', { name: label });
  // The list that opened last; a committed choice closes its list on the next frame.
  const list = () => within(screen.getAllByRole('listbox').at(-1) as HTMLElement);
  const pick = (name: string) =>
    fireEvent.keyDown(list().getByRole('option', { name }), { key: 'Enter' });
  it('ACCT-B04 ACCT-I03 an unset preference reads "workspace default" and a set one reads its value', () => {
    mount(<AccountPreferences account={account()} />);
    expect(combo(en.account.theme).textContent).toContain(en.account.workspaceDefault);
    expect(combo(en.account.locale).textContent).toContain(en.account.workspaceDefault);
    expect(combo(en.account.numerals).textContent).toContain(en.account.workspaceDefault);
    mount(
      <AccountPreferences
        account={account({
          preferences: {
            locale: 'ar',
            timezone: 'UTC',
            theme: 'light',
            numerals: 'arabic',
            explicit: ['locale', 'theme', 'numerals'],
          },
        })}
      />,
    );
    expect(combo(en.account.theme).textContent).toContain(en.account.light);
    expect(combo(en.account.locale).textContent).toContain(en.account.arabic);
    expect(combo(en.account.numerals).textContent).toContain(en.account.arabicNumerals);
  });
  it('ACCT-B04 ACCT-I03 a value the workspace sets is not shown as the reader own, even when equal', () => {
    // The response carries the inherited value, but the row does not exist: the control says so.
    mount(
      <AccountPreferences
        account={account({
          preferences: {
            locale: 'ar',
            timezone: 'UTC',
            theme: 'light',
            numerals: 'arabic',
            explicit: ['theme'],
          },
        })}
      />,
    );
    expect(combo(en.account.theme).textContent).toContain(en.account.light);
    expect(combo(en.account.locale).textContent).toContain(en.account.workspaceDefault);
    expect(combo(en.account.numerals).textContent).toContain(en.account.workspaceDefault);
  });
  it('ACCT-B04 ACCT-A03 picking a value writes that key alone with the current revision', () => {
    mount(<AccountPreferences account={account()} />);
    fireEvent.click(combo(en.account.locale));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([en.account.workspaceDefault, en.account.english, en.account.arabic]);
    pick(en.account.arabic);
    expect(state.patch.mutate).toHaveBeenCalledTimes(1);
    expect(state.patch.mutate).toHaveBeenCalledWith(
      { revision: 3, locale: 'ar' },
      expect.anything(),
    );
  });
  it('ACCT-I03 ACCT-A03 choosing the workspace default sends "" so the row is cleared rather than copied', () => {
    mount(
      <AccountPreferences
        account={account({
          preferences: {
            locale: 'ar',
            timezone: 'UTC',
            theme: 'dark',
            numerals: 'western',
            explicit: ['locale'],
          },
        })}
      />,
    );
    fireEvent.click(combo(en.account.locale));
    pick(en.account.workspaceDefault);
    expect(state.patch.mutate).toHaveBeenCalledWith({ revision: 3, locale: '' }, expect.anything());
    // Choosing what is already chosen writes nothing.
    fireEvent.click(combo(en.account.theme));
    pick(en.account.workspaceDefault);
    expect(state.patch.mutate).toHaveBeenCalledTimes(1);
  });
  it('ACCT-B04 the theme and numerals controls offer exactly the values the registry accepts', () => {
    mount(<AccountPreferences account={account()} />);
    fireEvent.click(combo(en.account.theme));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      en.account.workspaceDefault,
      en.account.dark,
      en.account.light,
    ]);
    pick(en.account.dark);
    expect(state.patch.mutate).toHaveBeenLastCalledWith(
      { revision: 3, theme: 'dark' },
      expect.anything(),
    );
    fireEvent.click(combo(en.account.numerals));
    expect(
      list()
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([en.account.workspaceDefault, en.account.western, en.account.arabicNumerals]);
    pick(en.account.arabicNumerals);
    expect(state.patch.mutate).toHaveBeenLastCalledWith({ revision: 3, numerals: 'arabic' });
  });
  it('ACCT-B04 a refused preference write is reported on the page', () => {
    state.patch.error = new ApiError(
      'validation_failed',
      'Check the entered values.',
      null,
      'req-2',
    );
    mount(<AccountPreferences account={account()} />);
    expect(screen.getByRole('alert').textContent).toContain('Check the entered values.');
  });
});
const passkey = {
  id: 'pk-1',
  name: null,
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-10-20T09:00:00.000Z',
  aaguid: null,
};
it('ACCT-B10 the passkeys section appears while the method is on or a passkey remains', () => {
  mount(<AccountPage />);
  expect(screen.queryByRole('heading', { name: en.account.passkeys })).toBeNull();
  state.query.data = { data: account({ passkeys: [passkey] }) };
  mount(<AccountPage />, 'ar');
  expect(screen.getByRole('heading', { name: ar.account.passkeys })).toBeTruthy();
  expect(screen.getByText(ar.account.passkeyUnnamed)).toBeTruthy();
  expect(screen.getByText(ar.account.passkeySynced)).toBeTruthy();
  // Off for the workspace, a passkey can still be removed but no new one added.
  expect(screen.queryByRole('button', { name: ar.account.passkeyAdd })).toBeNull();
});
it('ACCT-B10 removing a passkey asks first, then removes that one', () => {
  state.query.data = {
    data: account({ signInMethods: ['passkey'], passkeys: [{ ...passkey, name: 'Laptop' }] }),
  };
  mount(<AccountPage />);
  expect(screen.getByText('Laptop')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en.account.passkeyRemove }));
  expect(state.remove.mutate).not.toHaveBeenCalled();
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(en.account.passkeyRemoveConfirm)).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: en.common.confirm }));
  expect(state.remove.mutate).toHaveBeenCalledWith('pk-1');
});
it('ACCT-B10 ADMIN-B76 adding a passkey asks for the current password only while passwords are on', () => {
  state.query.data = { data: account({ signInMethods: ['password', 'passkey'] }) };
  mount(<AccountPage />);
  expect(screen.getByText(en.account.passkeyNone)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en.account.passkeyAdd }));
  const dialog = within(screen.getByRole('dialog'));
  const submit = dialog.getByRole('button', { name: en.account.passkeyAdd });
  expect(submit).toHaveProperty('disabled', true);
  fireEvent.change(dialog.getByLabelText(en.account.passkeyName), { target: { value: ' Laptop ' } });
  fireEvent.change(dialog.getByLabelText(en.account.currentPassword), {
    target: { value: 'secret-password' },
  });
  fireEvent.click(submit);
  expect(state.add.mutate.mock.calls[0]?.[0]).toEqual({
    name: 'Laptop',
    currentPassword: 'secret-password',
  });
  cleanup();
  state.query.data = { data: account({ signInMethods: ['passkey'] }) };
  mount(<AccountPage />);
  fireEvent.click(screen.getByRole('button', { name: en.account.passkeyAdd }));
  const alone = within(screen.getByRole('dialog'));
  expect(alone.getByLabelText(en.account.passkeyName)).toBeTruthy();
  expect(alone.queryByLabelText(en.account.currentPassword)).toBeNull();
});
