// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import en from '@/core/i18n/messages/en.json';
import ar from '@/core/i18n/messages/ar.json';
import { ApiError } from '@/core/http/client';
import type { Account } from '../../schema/validation';
import { AccountPage } from '../../ui/AccountPage';
import { AccountIdentity } from '../../ui/AccountIdentity';
import { AccountPreferences } from '../../ui/AccountPreferences';
import { account, mutation, person } from './fixtures';
import { mount } from './harness';
// The page is exercised without its network layer: the query hooks are the only seam, so each
// scenario hands the account in and watches what the controls ask to write.
const state = vi.hoisted(() => ({
  query: {} as { isPending: boolean; error: Error | null; data?: { data: Account } },
  patch: { mutate: vi.fn(), isPending: false, error: null as Error | null },
}));
vi.mock('../../ui/queries', () => ({
  useAccount: () => state.query,
  usePatchAccount: () => state.patch,
  useChangeEmail: () => mutation(),
  useChangePassword: () => mutation(),
  useRevokeSession: () => mutation(),
  useSignOutOthers: () => mutation(),
}));
beforeEach(() => {
  state.patch = { mutate: vi.fn(), isPending: false, error: null };
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
    expect(state.patch.mutate).toHaveBeenCalledWith({ revision: 3, locale: 'ar' });
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
    expect(state.patch.mutate).toHaveBeenCalledWith({ revision: 3, locale: '' });
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
    expect(state.patch.mutate).toHaveBeenLastCalledWith({ revision: 3, theme: 'dark' });
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
